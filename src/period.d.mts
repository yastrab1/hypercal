import type { Layout } from "./types";
export function shiftPeriod(date: Date, layout: Layout, step: number): Date;

export function monthRange(
  date: Date,
  mobile?: boolean,
): { from: Date; to: Date };

export function continuousRange(
  date: Date,
  layout: Layout,
): { from: Date; to: Date };
