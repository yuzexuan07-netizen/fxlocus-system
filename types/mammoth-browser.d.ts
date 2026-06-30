declare module "mammoth/mammoth.browser" {
  export type ExtractRawTextResult = {
    value: string;
    messages?: Array<unknown>;
  };

  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ExtractRawTextResult>;
}
