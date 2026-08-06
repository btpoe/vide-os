/// <reference types="vite/client" />

/**
 * File System Access declarations missing from TypeScript's DOM lib.
 * Used only inside `src/platform/web/`.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?:
      | FileSystemHandle
      | "desktop"
      | "documents"
      | "downloads"
      | "music"
      | "pictures"
      | "videos";
  }): Promise<FileSystemDirectoryHandle>;

  showOpenFilePicker(options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: FilePickerAcceptType[];
  }): Promise<FileSystemFileHandle[]>;

  showSaveFilePicker(options?: {
    suggestedName?: string;
    excludeAcceptAllOption?: boolean;
    types?: FilePickerAcceptType[];
  }): Promise<FileSystemFileHandle>;
}

declare namespace JSX {
  interface IntrinsicElements {
    "ve-panel": any;
    "ve-panel-layout": any;
  }
}
