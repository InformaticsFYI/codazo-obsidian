/** Call only after a byte bound. Reject duplicate decoded keys and deep nesting. */
export function parseStrictJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const stack: (Set<string> | null)[] = [];
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}[\]]/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? new Set() : null);
      if (stack.length > 32) throw new Error('invalid_json');
    } else if (token === '}' || token === ']') stack.pop();
    else {
      let next = match.index + token.length;
      while (/\s/.test(text[next] ?? '') && next < text.length) next++;
      if (text[next] !== ':') continue;
      const keys = stack.at(-1);
      const key: unknown = JSON.parse(token);
      if (typeof key !== 'string' || !keys || keys.has(key)) throw new Error('invalid_json');
      keys.add(key);
    }
  }
  return value;
}
