export function canonicalSourceKey(input: string): string {
  const prefix = input.match(/^(media:|video-page:|unread-pages:|limit:)/)?.[0] || '';
  try {
    const url = new URL(input.slice(prefix.length));
    url.hash = '';
    if (url.hostname === 'scorm.onilearning.com.br')
      for (const key of [...url.searchParams.keys()])
        if (
          ['acesso', 'scorm', 'estudante', 'token', 'signature', 'expires'].includes(
            key.toLowerCase(),
          )
        )
          url.searchParams.delete(key);
    url.searchParams.sort();
    return prefix + url.href;
  } catch {
    return input;
  }
}
