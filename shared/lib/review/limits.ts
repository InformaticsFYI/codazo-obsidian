/** Initial engineering ceilings, not measured model/runtime capacity. */
export const LIMITS = Object.freeze({
 sourceCodePoints: 4_000, intentCodePoints: 2_000, requestBytes: 32 * 1024,
 responseBytes: 256 * 1024, annotations: 12, vocabulary: 5, verbs: 3, exercises: 3,
 focuses: 3, quoteCodePoints: 500, stageCodePoints: 600, exampleCodePoints: 1_000,
 idCharacters: 64, expressionCodePoints: 200, tenses: 3, forms: 6, examples: 3,
 lexicalItems: 5, jsonDepth: 12, jsonNodes: 4_096, objectKeys: 32,
});
export function codePointLength(text: string): number {
 let count = 0;
 const points = text[Symbol.iterator]();
 while (!points.next().done) count++;
 return count;
}
export function utf8ByteLength(text: string): number {
 return new TextEncoder().encode(text).byteLength;
}
/** Bounded JSON-tree inspection; no getters/toJSON or recursive stringification. */
/** Control-flow error for the bounded JSON walk; never surfaces outside inspectJSONValue. */
class LimitError extends Error { constructor(public readonly code: 'too_large' | 'invalid') { super(code); this.name = 'LimitError'; } }
export function inspectJSONValue(input: unknown, maxBytes: number): 'ok' | 'too_large' | 'invalid' {
 let bytes = 0;
 let nodes = 0;
 const ancestors = new Set<object>();
 const add = (n:number) => { bytes += n; if (bytes > maxBytes) throw new LimitError('too_large'); };
 const walk = (value:unknown, depth:number): void => {
  if (++nodes > LIMITS.jsonNodes || depth > LIMITS.jsonDepth) throw new LimitError('invalid');
  if (value === null) { add(4); return; }
  if (typeof value === 'string') {
   if (value.length > maxBytes) throw new LimitError('too_large');
   add(utf8ByteLength(JSON.stringify(value))); return;
  }
  if (typeof value === 'boolean') { add(value ? 4 : 5); return; }
  if (typeof value === 'number' && Number.isFinite(value)) { add(String(value).length); return; }
  if (typeof value !== 'object') throw new LimitError('invalid');
  const array = Array.isArray(value);
  const proto: unknown = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new LimitError('invalid');
  if (ancestors.has(value)) throw new LimitError('invalid');
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length > LIMITS.objectKeys) throw new LimitError('invalid');
  add(2);
  let members = 0;
  for (const key of keys) {
   if (array && key === 'length') continue;
   if (typeof key !== 'string') throw new LimitError('invalid');
   const descriptor = Object.getOwnPropertyDescriptor(value,key);
   if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new LimitError('invalid');
   if (array && key !== String(members)) throw new LimitError('invalid');
   if (members++) add(1);
   if (!array) { if(key.length > maxBytes) throw new LimitError('too_large'); add(utf8ByteLength(JSON.stringify(key)) + 1); }
   walk(descriptor.value as unknown, depth + 1);
  }
  if (array && (value as unknown[]).length !== members) throw new LimitError('invalid');
  ancestors.delete(value);
 };
 try { walk(input,0); return 'ok'; } catch (error) { return error instanceof LimitError && error.code === 'too_large' ? 'too_large' : 'invalid'; }
}
