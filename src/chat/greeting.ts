const GREETING_RE = /^\s*(?:hi+|hello+|hey+|hola|namaste|good\s+(?:morning|afternoon|evening)|yo|sup)(?:\s+(?:there|team|sir|madam|everyone))?[\s!.,?]*$/i;

export const isGreeting = (text: string) => GREETING_RE.test(text);
