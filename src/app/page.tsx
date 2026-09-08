import { CapturedEnhancements } from "@/components/CapturedEnhancements";
import { CreativeDirector } from "@/components/CreativeDirector";
import { CapturedPage } from "@/components/CapturedPage";
import { RiveEnhancements } from "@/components/RiveEnhancements";
import { SceneLayer } from "@/components/SceneLayer";

export default function Home() {
  return (
    <div id="top">
      <SceneLayer />
      <CapturedPage />
      <CapturedEnhancements />
      <RiveEnhancements />
      <CreativeDirector />
    </div>
  );
}
