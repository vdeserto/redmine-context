/**
 * Gerador de fixture de áudio WAV EM RUNTIME para o teste de integração da #60 —
 * sem fixture binária versionada no repo (mesmo padrão de `text-png.ts`). Produz um
 * WAV PCM 16-bit válido (silêncio) com a taxa/canais dados, para o ffmpeg
 * transcodificar para 16 kHz mono no teste opt-in.
 */

/** Parâmetros do WAV a gerar. */
export interface WavFixtureSpec {
  /** Taxa de amostragem do fixture (Hz). */
  readonly sampleRate: number;
  /** Número de canais (1 = mono, 2 = estéreo). */
  readonly channels: number;
  /** Duração em segundos. */
  readonly durationSec: number;
}

/**
 * Gera um Buffer de um arquivo WAV PCM 16-bit (silêncio) conforme a spec. Header
 * canônico de 44 bytes seguido dos samples zerados.
 *
 * @param spec - Taxa/canais/duração — ver {@link WavFixtureSpec}.
 * @returns Buffer com o conteúdo binário do arquivo `.wav`.
 */
export function makeWavFixture(spec: WavFixtureSpec): Buffer {
  const { sampleRate, channels, durationSec } = spec;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const numFrames = Math.max(1, Math.round(sampleRate * durationSec));
  const dataSize = numFrames * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // tamanho do sub-chunk fmt
  header.writeUInt16LE(1, 20); // audioFormat = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  // Silêncio: samples zerados (Buffer.alloc já zera).
  return Buffer.concat([header, Buffer.alloc(dataSize)]);
}

/** Taxa/canais lidos do header de um WAV PCM (bytes 22-27). */
export interface WavHeaderInfo {
  readonly channels: number;
  readonly sampleRate: number;
}

/**
 * Lê taxa de amostragem e canais do header de um WAV PCM canônico.
 *
 * @param buffer - Conteúdo binário do `.wav`.
 * @returns `{ channels, sampleRate }` extraídos do header.
 */
export function readWavHeader(buffer: Buffer): WavHeaderInfo {
  return {
    channels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
  };
}
