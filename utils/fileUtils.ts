
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // The result is a data URL: "data:audio/mpeg;base64,..."
      // We only need the base64 part.
      const result = reader.result as string;
      const base64String = result.split(',')[1];
      if (base64String) {
        resolve(base64String);
      } else {
        reject(new Error("Failed to read file as Base64."));
      }
    };
    reader.onerror = (error) => reject(error);
  });
};

export function base64ToBytes(base64: string): Uint8Array {
    const binString = atob(base64);
    const len = binString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
}

export const compressImageBase64 = (
    base64: string,
    mimeType: string,
    maxWidth: number,
    maxHeight: number,
    quality: number = 0.85
): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = `data:${mimeType};base64,${base64}`;
        img.onload = () => {
            let { width, height } = img;
            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error("Could not get canvas context."));
            }
            ctx.drawImage(img, 0, 0, width, height);

            const newMimeType = 'image/jpeg';
            const dataUrl = canvas.toDataURL(newMimeType, quality);
            const newBase64 = dataUrl.split(',')[1];

            if (!newBase64) {
                return reject(new Error("Failed to compress image."));
            }
            resolve({ base64: newBase64, mimeType: newMimeType });
        };
        img.onerror = (error) => reject(new Error(`Image loading failed for compression: ${error}`));
    });
};

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

export const pcmToWavBlob = (
    pcmData: Uint8Array,
    sampleRate: number = 24000,
    numChannels: number = 1,
    bitsPerSample: number = 16
): Blob => {
    const dataSize = pcmData.length;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true); // ChunkSize
    writeString(view, 8, 'WAVE');

    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    view.setUint32(28, byteRate, true); // ByteRate
    const blockAlign = numChannels * (bitsPerSample / 8);
    view.setUint16(32, blockAlign, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample

    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true); // Subchunk2Size

    // Write the PCM data
    new Uint8Array(buffer).set(pcmData, 44);

    return new Blob([view], { type: 'audio/wav' });
};