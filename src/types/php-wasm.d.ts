declare module 'php-wasm' {
  export interface PhpResult {
    text: string;
    exitCode: number;
  }

  export class PhpWasm {
    constructor();
    binary: Promise<void>;
    run(code: string): Promise<PhpResult>;
  }
}