import { lazy, type ComponentType } from "react";
import type { FnCode } from "../lib/commands";
import { ANR, DES, DVD, ERN, FA, HP } from "./equity";
import { CN, TOP } from "./news";
import { EQS, HELP, MOST, W } from "./screener";
import type { ScreenProps } from "./types";

// Chart-lastige Funktionen werden erst bei Bedarf geladen
const GP = lazy(() => import("./GP"));
const macro = () => import("./macro");
const lazyMacro = (name: "WEI" | "FX" | "CMDT" | "GC" | "SPRD" | "ECO" | "ECST") =>
  lazy(async () => ({ default: (await macro())[name] }));
const IMAP = lazy(() => import("./IMAP"));

export const SCREENS: Record<FnCode, ComponentType<ScreenProps>> = {
  GP,
  DES,
  HP,
  FA,
  ERN,
  DVD,
  ANR,
  CN,
  TOP,
  WEI: lazyMacro("WEI"),
  FX: lazyMacro("FX"),
  CMDT: lazyMacro("CMDT"),
  GC: lazyMacro("GC"),
  SPRD: lazyMacro("SPRD"),
  ECO: lazyMacro("ECO"),
  ECST: lazyMacro("ECST"),
  EQS,
  IMAP,
  MOST,
  W,
  HELP,
};
