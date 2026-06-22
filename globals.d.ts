declare global {
  interface Window {
    JSZip: new () => {
      folder(name: string): {
        file(path: string, data: string): void;
      };
      file(path: string, data: string): void;
      generateAsync(options: { type: "blob" }): Promise<Blob>;
    };
  }
}

export {};
