import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { env } from "../env";

/**
 * Edição dos vídeos com FFmpeg, no próprio servidor do CRM (sem custo):
 *  - acabamento: vídeo da IA em 720x1280 + 2 s de encerramento com nome, modalidade e WhatsApp;
 *  - marca d'água "PENDENTE DE PAGAMENTO" para a prévia enviada ao cliente;
 *  - simulador: transforma a foto num vídeo curto, para testar o fluxo inteiro sem gastar com IA.
 * Os arquivos de trabalho ficam numa pasta temporária apagada ao final de cada operação.
 */
const ASSETS = path.join(process.cwd(), "assets", "video");
const WATERMARK = path.join(ASSETS, "marca-dagua.png");
const FONT = path.join(ASSETS, "LiberationSans-Bold.ttf");
const WA_ICON = path.join(ASSETS, "whatsapp-icone.png");
const W = 720;
const H = 1280;
const ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];

export function ffmpegPath(): string {
  const configured = env().FFMPEG_PATH;
  if (configured) return configured;
  try {
    const p = createRequire(import.meta.url)("ffmpeg-static") as string | null;
    if (p) return p;
  } catch {
    // pacote ausente: tenta o ffmpeg do sistema
  }
  return "ffmpeg";
}

function run(args: string[], timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(/*turbopackIgnore: true*/ ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(`FFmpeg falhou: ${String(stderr || err.message).trim().slice(-300)}`));
      else resolve();
    });
  });
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pd-video-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Escala/recorta para 720x1280 (vertical) sem distorcer. */
const FIT = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30`;

/** Prévia para aprovação: sobrepõe a marca d'água (texto + selo Ponto Digital) ao vídeo inteiro. */
export async function applyWatermark(video: Uint8Array): Promise<Buffer> {
  return withTmp(async (dir) => {
    const input = path.join(dir, "in.mp4");
    const out = path.join(dir, "previa.mp4");
    await writeFile(input, video);
    await run(["-i", input, "-i", WATERMARK, "-filter_complex", `[0:v]${FIT}[v];[1:v]scale=${W}:${H}[wm];[v][wm]overlay=0:0:format=auto[o]`, "-map", "[o]", "-map", "0:a?", ...ENC, out]);
    return readFile(out);
  });
}

const hasAudio = async (file: string) =>
  new Promise<boolean>((resolve) => {
    // "-map 0:a:0 -f null" falha quando não existe faixa de áudio.
    execFile(/*turbopackIgnore: true*/ ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0:a:0", "-t", "0.1", "-f", "null", "-"], { timeout: 30_000 }, (err) => resolve(!err));
  });

/**
 * Acabamento do vídeo da IA: 720x1280, 30 fps, WhatsApp no rodapé durante a fala e mais 2 s de logo final
 * (nome em dourado sobre fundo preto). Os textos são desenhados aqui porque os modelos de vídeo erram letras e números.
 */
export async function finishVideo(video: Uint8Array, lines: { title: string; subtitle: string; phone: string }): Promise<Buffer> {
  return withTmp(async (dir) => {
    const input = path.join(dir, "ia.mp4");
    const out = path.join(dir, "final.mp4");
    await writeFile(input, video);
    const files = { title: path.join(dir, "t1.txt"), subtitle: path.join(dir, "t2.txt"), phone: path.join(dir, "t3.txt"), wa: path.join(dir, "t4.txt") };
    await Promise.all([
      writeFile(files.title, lines.title || " "),
      writeFile(files.subtitle, lines.subtitle || " "),
      writeFile(files.phone, lines.phone ? `WhatsApp ${lines.phone}` : " "),
      writeFile(files.wa, lines.phone),
    ]);
    const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
    const txt = (file: string, size: number, y: string, extra = "fontcolor=white") => `drawtext=fontfile='${esc(FONT)}':textfile='${esc(file)}':fontsize=${size}:${extra}:x=(w-text_w)/2:y=${y}`;
    const gold = "fontcolor=0xD4AF37";
    const card = [
      `color=c=black:s=${W}x${H}:d=2:r=30`,
      "format=yuv420p",
      `drawbox=x=(iw-360)/2:y=ih*0.40-30:w=360:h=3:color=0xD4AF37:t=fill`,
      txt(files.title, 66, "h*0.40", gold),
      txt(files.subtitle, 32, "h*0.40+92", "fontcolor=white"),
      `drawbox=x=(iw-360)/2:y=ih*0.40+150:w=360:h=3:color=0xD4AF37:t=fill`,
      ...(lines.phone ? [txt(files.phone, 38, "h*0.40+185", gold)] : []),
      "fade=t=in:st=0:d=0.4",
    ].join(",");
    // Rodapé: ícone do WhatsApp + número, centralizados numa faixa escura translúcida.
    const bar = lines.phone ? footerLayout(lines.phone) : null;
    const waBar = bar
      ? `,drawbox=x=${bar.boxX}:y=${H - 205}:w=${bar.boxW}:h=72:color=black@0.55:t=fill,drawtext=fontfile='${esc(FONT)}':textfile='${esc(files.wa)}':fontsize=${FOOT_SIZE}:fontcolor=white:x=${bar.textX}:y=${H - 191}[vt];[vt][1:v]overlay=${bar.iconX}:${H - 193}`
      : "";
    const audio = (await hasAudio(input))
      ? "[0:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=8,atrim=0:8,asetpts=PTS-STARTPTS[a0]"
      : "anullsrc=r=44100:cl=stereo,atrim=0:8[a0]";
    const filter = [
      `[0:v]${FIT},tpad=stop_mode=clone:stop_duration=8,trim=0:8,setpts=PTS-STARTPTS,format=yuv420p${waBar}[v0]`,
      audio,
      `${card}[v1]`,
      "anullsrc=r=44100:cl=stereo,atrim=0:2[a1]",
      "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
    ].join(";");
    await run(["-i", input, "-i", WA_ICON, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", ...ENC, out]);
    return readFile(out);
  });
}

const FOOT_SIZE = 42;
const ICON = 48;
// Larguras da Liberation Sans Bold (mesmas métricas da Arial) em milésimos de "em": centraliza ícone + número.
const ADVANCE: Record<string, number> = { " ": 278, "(": 333, ")": 333, "-": 333, "+": 584 };
export function footerLayout(phone: string) {
  const textW = Math.round([...phone].reduce((w, ch) => w + (/\d/.test(ch) ? 556 : (ADVANCE[ch] ?? 556)), 0) * (FOOT_SIZE / 1000));
  const gap = 14;
  const total = ICON + gap + textW;
  const iconX = Math.round((W - total) / 2);
  return { iconX, textX: iconX + ICON + gap, boxX: Math.max(0, iconX - 22), boxW: Math.min(W, total + 44) };
}

/** Simulador (sem IA): a foto vira um vídeo de 8 s com aproximação lenta. Serve só para testar o fluxo. */
export async function photoToVideo(image: Uint8Array, mime: string): Promise<Buffer> {
  return withTmp(async (dir) => {
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const input = path.join(dir, `foto.${ext}`);
    const out = path.join(dir, "simulado.mp4");
    await writeFile(input, image);
    await run([
      "-loop", "1", "-i", input,
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-filter_complex", `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0008,1.15)':d=240:s=${W}x${H}:fps=30,format=yuv420p[v]`,
      "-map", "[v]", "-map", "1:a", "-t", "8", ...ENC, out,
    ]);
    return readFile(out);
  });
}

/** Converte o avatar para JPEG vertical 1080x1920 (aceito pelo WhatsApp e leve para enviar). */
export async function toJpeg(image: Uint8Array, mime: string): Promise<Buffer> {
  return withTmp(async (dir) => {
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const input = path.join(dir, `in.${ext}`);
    const out = path.join(dir, "avatar.jpg");
    await writeFile(input, image);
    await run(["-i", input, "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1", "-frames:v", "1", "-q:v", "3", out], 60_000);
    return readFile(out);
  });
}

/** Áudio gravado → mensagem de voz do WhatsApp (OGG/Opus, mono). */
export async function toVoiceNote(audio: Uint8Array): Promise<Buffer> {
  return withTmp(async (dir) => {
    const input = path.join(dir, "in.audio");
    const out = path.join(dir, "voz.ogg");
    await writeFile(input, audio);
    await run(["-i", input, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", out], 60_000);
    return readFile(out);
  });
}
