/**
 * Minimal types for mp4box.js.
 *
 * The package ships no types. Rather than pulling in a community package or
 * casting to `any` at every call site, we declare exactly the surface we use.
 * If we start using more of the library, this file grows deliberately.
 */
declare module 'mp4box' {
  export interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
  }

  export interface MP4VideoTrack {
    id: number;
    codec: string;
    nb_samples: number;
    video: { width: number; height: number };
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    videoTracks: MP4VideoTrack[];
  }

  export interface MP4Sample {
    is_sync: boolean;
    cts: number;
    dts: number;
    duration: number;
    timescale: number;
    data: ArrayBuffer;
  }

  interface ConfigBox {
    write(stream: unknown): void;
  }

  interface StsdEntry {
    avcC?: ConfigBox;
    hvcC?: ConfigBox;
    vpcC?: ConfigBox;
    av1C?: ConfigBox;
  }

  export interface MP4Track {
    mdia?: { minf?: { stbl?: { stsd?: { entries: StsdEntry[] } } } };
  }

  export interface MP4File {
    onReady: (info: MP4Info) => void;
    onError: (e: string) => void;
    onSamples: (id: number, user: unknown, samples: MP4Sample[]) => void;
    appendBuffer(data: MP4ArrayBuffer): void;
    start(): void;
    stop(): void;
    flush(): void;
    getTrackById(id: number): MP4Track | undefined;
    setExtractionOptions(id: number, user: unknown, options: { nbSamples: number }): void;
  }

  const MP4Box: {
    createFile(): MP4File;
    DataStream: {
      new (buffer?: ArrayBuffer, byteOffset?: number, endianness?: boolean): {
        buffer: ArrayBuffer;
      };
      BIG_ENDIAN: boolean;
    };
  };

  export default MP4Box;
}
