/**
 * PHASE ID-2: اشتقاق وتحقق PIN المدير عبر PBKDF2 (Web Crypto API فقط).
 * لا تخزين لأي PIN كنص صريح تحت أي ظرف — فقط ملح عشوائي + hash مشتق.
 * معاملات مركزية هنا، لا تتوزع في أي واجهة مستخدم.
 */

export type PinCredential = {
  salt: string; // base64
  derivedHash: string; // base64
  iterations: number;
  algorithmVersion: 1;
};

const ITERATIONS = 100_000;
const HASH_ALGORITHM = "SHA-256";
const DERIVED_KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;

/** PIN صالح = 6 أرقام لاتينية (0-9) بالضبط، بلا مسافات. لا تطبيع للأرقام العربية-الهندية — تُرفض كصيغة غير صالحة. */
export const isValidPinFormat = (pin: string): boolean => /^[0-9]{6}$/.test(pin);

const bytesToBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const derivePinBits = async (pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> => {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: HASH_ALGORITHM },
    keyMaterial,
    DERIVED_KEY_LENGTH_BITS,
  );
  return new Uint8Array(derivedBits);
};

/** تشتق بيانات اعتماد جديدة (ملح عشوائي جديد + hash) — لا تُستدعى إلا عند إنشاء/تغيير PIN. */
export const derivePinCredential = async (pin: string): Promise<PinCredential> => {
  if (!isValidPinFormat(pin)) throw new Error("صيغة PIN غير صالحة");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const derived = await derivePinBits(pin, salt, ITERATIONS);
  return {
    salt: bytesToBase64(salt),
    derivedHash: bytesToBase64(derived),
    iterations: ITERATIONS,
    algorithmVersion: 1,
  };
};

/** يتحقق من PIN مقابل بيانات اعتماد مخزَّنة مسبقًا، بلا فك أو استرجاع PIN الأصلي إطلاقًا. */
export const verifyPinCredential = async (pin: string, credential: PinCredential): Promise<boolean> => {
  if (!isValidPinFormat(pin)) return false;
  const salt = base64ToBytes(credential.salt);
  const derived = await derivePinBits(pin, salt, credential.iterations);
  const candidate = bytesToBase64(derived);
  return candidate === credential.derivedHash;
};
