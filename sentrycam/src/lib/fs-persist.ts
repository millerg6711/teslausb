const DB_NAME = 'sentrycam';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'lastDirectory';

/** Open (or create) the IndexedDB database */
const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Save a FileSystemDirectoryHandle to IndexedDB */
export const saveDirectoryHandle = async (
  handle: FileSystemDirectoryHandle
): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

/** Load the last saved FileSystemDirectoryHandle */
export const loadDirectoryHandle =
  async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const db = await openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  };

/** Clear the saved directory handle */
export const clearDirectoryHandle = async (): Promise<void> => {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
};

/** Read all files recursively from a FileSystemDirectoryHandle */
export const readFilesFromHandle = async (
  dirHandle: FileSystemDirectoryHandle,
  path = ''
): Promise<File[]> => {
  const files: File[] = [];
  // Use `any` cast — .values() exists at runtime but TS defs are incomplete
  const iter = (dirHandle as any).values() as AsyncIterable<FileSystemHandle>;

  for await (const entry of iter) {
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      const lower = file.name.toLowerCase();
      if (
        lower.endsWith('.mp4') ||
        lower.endsWith('.json') ||
        lower.endsWith('.png')
      ) {
        Object.defineProperty(file, '_teslaPath', {
          value: path + file.name,
          writable: false,
        });
        files.push(file);
      }
    } else if (entry.kind === 'directory') {
      const subFiles = await readFilesFromHandle(
        entry as FileSystemDirectoryHandle,
        path + entry.name + '/'
      );
      files.push(...subFiles);
    }
  }

  return files;
};

/** Check if showDirectoryPicker is supported */
export const hasDirectoryPickerSupport = (): boolean =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;
