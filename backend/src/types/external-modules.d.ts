declare module 'pg' {
  export class Pool {
    constructor(config?: Record<string, unknown>);
    query(...args: any[]): Promise<any>;
    end(): Promise<void>;
  }
}

declare module 'multer' {
  export interface File {
    mimetype: string;
    originalname: string;
  }

  export type FileFilterCallback = (error: Error | null, acceptFile?: boolean) => void;

  export interface Options {
    storage?: any;
    limits?: Record<string, unknown>;
    fileFilter?: (req: any, file: File, callback: FileFilterCallback) => void;
  }

  interface MulterInstance {
    single(fieldName: string): any;
    array(fieldName: string, maxCount?: number): any;
  }

  interface MulterFactory {
    (options?: Options): MulterInstance;
    memoryStorage(): any;
  }

  const multer: MulterFactory;
  export default multer;
}