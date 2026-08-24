import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = "/home/ubuntu/khabir-alshawahid-prototype";
const readManifest = async (variant) => JSON.parse(await readFile(path.join(projectRoot, "dist", variant, "manifest.webmanifest"), "utf8"));
const assetNames = async (variant) => readdir(path.join(projectRoot, "dist", variant, "assets"));

const teacherManifest = await readManifest("teacher");
const directorManifest = await readManifest("director");
const teacherAssets = await assetNames("teacher");
const directorAssets = await assetNames("director");

if (teacherManifest.name !== "خبير الشواهد") throw new Error("Teacher build manifest identity is incorrect");
if (directorManifest.name !== "خبير الشواهد للمدير") throw new Error("Director build manifest identity is incorrect");
const expectedStoreIcons = [
  "/assets/khabir-alshawahid-store-icon-192.png",
  "/assets/khabir-alshawahid-store-icon-512.png",
];
const iconSources = (manifest) => manifest.icons?.map((icon) => icon.src) || [];
if (JSON.stringify(iconSources(teacherManifest)) !== JSON.stringify(expectedStoreIcons)) throw new Error("Teacher build icon identity is incorrect");
if (JSON.stringify(iconSources(directorManifest)) !== JSON.stringify(expectedStoreIcons)) throw new Error("Director build icon identity is incorrect");
if (teacherAssets.some((name) => name.startsWith("Director-"))) throw new Error("Teacher build should not contain the Director page bundle");
if (directorAssets.some((name) => name.startsWith("Home-"))) throw new Error("Director build should not contain the teacher Home page bundle");

console.log("Teacher and Director PWA builds are separated successfully.");
