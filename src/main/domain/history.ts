import path from "path";
import fs from "fs-extra";
import { app } from "electron";
import { RecordingData, RecordingMeta } from "../../types";
import { invalidateUiKeys } from "../ipc/invalidate-ui";
import { QueryKeys } from "../../query-keys";
import * as ffmpeg from "./ffmpeg";
import * as whisper from "./whisper";

export const init = async () => {
  await fs.ensureDir(path.join(app.getPath("userData"), "recordings"));
};

export const getRecordingsFolder = () => {
  return path.join(app.getPath("userData"), "recordings");
};

export const saveRecording = async (recording: RecordingData) => {
  const date = new Date();
  const folder = path.join(
    getRecordingsFolder(),
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}_${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`,
  );
  await fs.ensureDir(folder);
  if (recording.mic) {
    await fs.writeFile(
      path.join(folder, "mic.webm"),
      Buffer.from(recording.mic),
    );
  }
  if (recording.screen) {
    await fs.writeFile(
      path.join(folder, "screen.webm"),
      Buffer.from(recording.screen),
    );
  }
  await fs.writeJSON(path.join(folder, "meta.json"), recording.meta, {
    spaces: 2,
  });
};

export const listRecordings = async () => {
  const recordingFolders = await fs.readdir(getRecordingsFolder());
  const items = await Promise.all(
    recordingFolders.map(
      async (recordingFolder) =>
        [
          recordingFolder,
          (await fs.readJson(
            path.join(getRecordingsFolder(), recordingFolder, "meta.json"),
          )) as RecordingMeta,
        ] as const,
    ),
  );
  return items.reduce(
    (acc, [folder, meta]) => {
      acc[folder] = meta;
      return acc;
    },
    {} as Record<string, RecordingMeta>,
  );
};

export const updateRecording = async (
  recordingId: string,
  partial: Partial<RecordingMeta>,
) => {
  const meta = await fs.readJson(
    path.join(getRecordingsFolder(), recordingId, "meta.json"),
  );
  await fs.writeJson(
    path.join(getRecordingsFolder(), recordingId, "meta.json"),
    {
      ...meta,
      ...partial,
    },
  );
  invalidateUiKeys(QueryKeys.History, recordingId);
  invalidateUiKeys(QueryKeys.History);
};

export const postProcessRecording = async (id: string) => {
  const mic = path.join(getRecordingsFolder(), id, "mic.webm");
  const screen = path.join(getRecordingsFolder(), id, "screen.webm");
  const wav = path.join(getRecordingsFolder(), id, "whisper-input.wav");

  if (fs.existsSync(mic) && fs.existsSync(screen)) {
    await ffmpeg.toStereoWavFile(mic, screen, wav);
  } else if (fs.existsSync(mic)) {
    await ffmpeg.toWavFile(mic, wav);
  } else if (fs.existsSync(screen)) {
    await ffmpeg.toWavFile(screen, wav);
  } else {
    throw new Error("No recording found");
  }

  await whisper.processWavFile(
    wav,
    path.join(getRecordingsFolder(), id, "transcript.json"),
    "ggml-large-v3-q5_0",
  );

  await fs.rm(wav);
};
