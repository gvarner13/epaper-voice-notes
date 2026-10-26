import { createServerFn } from "@tanstack/react-start";
import { listRecordings, readTranscript } from "./cloud.server";
import { RECORDING_ID } from "./recordings";

export const getRecordings = createServerFn({ method: "GET" }).handler(() =>
  listRecordings(),
);

export const getTranscript = createServerFn({ method: "GET" })
  .validator((id: unknown) => {
    if (typeof id !== "string" || !RECORDING_ID.test(id))
      throw new Error("Invalid recording ID");
    return id;
  })
  .handler(({ data }) => readTranscript(data));
