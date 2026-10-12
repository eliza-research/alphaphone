/** Native Photos returns inline JPEG bytes. Decode them locally: the Android
 * fetch bridge need not support data URLs. Browser Photos may return a blob URL. */
export async function readLocalPhotoImage(uri: string, signal: AbortSignal, load: typeof fetch = fetch): Promise<Blob> {
 signal.throwIfAborted();
 if (uri.startsWith('blob:')) {
  const response = await load(uri, {signal});
  const image = await response.blob();
  signal.throwIfAborted();
  return image;
 }
 const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(uri);
 if (!match || !match[2]) throw Error('Choose a readable local image.');
 const binary = atob(match[2]);
 const bytes = new Uint8Array(binary.length);
 for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
 signal.throwIfAborted();
 return new Blob([bytes], {type: match[1]});
}
