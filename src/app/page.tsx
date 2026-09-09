import { CapturedEnhancements } from "@/components/CapturedEnhancements";
import { CreativeDirector } from "@/components/CreativeDirector";
import { CapturedPage } from "@/components/CapturedPage";
import { RiveEnhancements } from "@/components/RiveEnhancements";
import { SceneLayer } from "@/components/SceneLayer";
import { WritingRoomBureauCourses } from "@/components/WritingRoomBureauCourses";

export default function Home() {
  return (
    <div id="top">
      <SceneLayer />
      <CapturedPage />
      <WritingRoomBureauCourses />
      <CapturedEnhancements />
      <RiveEnhancements />
      <CreativeDirector />
    </div>
  );
}
