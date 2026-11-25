import { describe, expect, it } from "vitest";

import { getSeedanceUploadContract } from "@/lib/seedance-media-policy";
import { validateUploadFile } from "@/lib/upload-validation";

function file(bytes: number[], name: string, type: string) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("Seedance upload declaration and magic validation", () => {
  const contract = getSeedanceUploadContract("doubao-seedance-2-0-260128")!;

  it("accepts TIFF and HEIC only when the Seedance MIME contract opts in", async () => {
    const tiff = file([0x49, 0x49, 0x2a, 0x00, 1], "reference.tiff", "image/tiff");
    const heic = file(
      [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0],
      "reference.heic",
      "image/heic",
    );

    await expect(validateUploadFile(tiff)).resolves.toMatchObject({ ok: false });
    await expect(validateUploadFile(heic)).resolves.toMatchObject({ ok: false });
    await expect(
      validateUploadFile(tiff, [...contract.allowedKinds], contract.maxBytes, contract.allowedMimeTypes),
    ).resolves.toMatchObject({ ok: true, kind: "image" });
    await expect(
      validateUploadFile(heic, [...contract.allowedKinds], contract.maxBytes, contract.allowedMimeTypes),
    ).resolves.toMatchObject({ ok: true, kind: "image" });
  });

  it("rejects WebM and Matroska for Seedance while preserving generic video behavior", async () => {
    const ebml = [0x1a, 0x45, 0xdf, 0xa3, 1];
    const webm = file(ebml, "reference.webm", "video/webm");
    const disguised = file(ebml, "reference.mp4", "video/mp4");

    await expect(validateUploadFile(webm)).resolves.toMatchObject({ ok: true, kind: "video" });
    await expect(
      validateUploadFile(webm, [...contract.allowedKinds], contract.maxBytes, contract.allowedMimeTypes),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      validateUploadFile(disguised, [...contract.allowedKinds], contract.maxBytes, contract.allowedMimeTypes),
    ).resolves.toMatchObject({ ok: false });
  });

  it("enforces Seedance image, video, and audio byte ceilings without changing defaults", async () => {
    const tooLargeAudio = new File(
      [new Uint8Array([0x49, 0x44, 0x33, 1]), new Uint8Array(15 * 1024 * 1024)],
      "large.mp3",
      { type: "audio/mpeg" },
    );

    await expect(
      validateUploadFile(
        tooLargeAudio,
        [...contract.allowedKinds],
        contract.maxBytes,
        contract.allowedMimeTypes,
      ),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("15MB") });
  });
});
