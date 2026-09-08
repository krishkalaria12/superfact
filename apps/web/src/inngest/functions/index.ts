import { extractPageBatch } from "./extract-page-batch";
import { parsePageBatch } from "./parse-page-batch";
import { runPipeline } from "./run-pipeline";

export const functions = [runPipeline, parsePageBatch, extractPageBatch];
