function looksLikeUtf8Mojibake(value: string) {
  return /[Ãåæçéðï]/.test(value);
}

function scoreReadableText(value: string) {
  let score = 0;
  if (/[\u4e00-\u9fff]/.test(value)) score += 4;
  if (/[\u3040-\u30ff]/.test(value)) score += 2;
  if (/[\uac00-\ud7af]/.test(value)) score += 2;
  if (/[\u{1F300}-\u{1FAFF}]/u.test(value)) score += 3;
  if (/[A-Za-z0-9]/.test(value)) score += 1;
  if (/\uFFFD/.test(value)) score -= 6;
  if (/[Ãåæçéðï]/.test(value)) score -= 2;
  return score;
}

export function repairMojibake(value: string | null | undefined) {
  const raw = String(value ?? "");
  if (!raw || !looksLikeUtf8Mojibake(raw)) return raw;

  try {
    const bytes = Uint8Array.from(Array.from(raw).map((char) => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (!decoded || decoded === raw) return raw;
    return scoreReadableText(decoded) > scoreReadableText(raw) ? decoded : raw;
  } catch {
    return raw;
  }
}
