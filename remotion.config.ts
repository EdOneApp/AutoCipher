import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Rendu CPU-only en CI : pas d'accélération GPU disponible sur les runners.
Config.setChromiumOpenGlRenderer("angle");
Config.setConcurrency(2);
