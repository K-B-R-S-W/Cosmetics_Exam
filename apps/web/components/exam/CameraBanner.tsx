import { Notice } from "@/components/candidate/CandidateContext";

export function cameraBannerText({ cameraLost, microphoneLost, connectionLost }: {
  cameraLost: boolean;
  microphoneLost: boolean;
  connectionLost: boolean;
}): string | null {
  if (cameraLost && microphoneLost) return "Camera and microphone disconnected. Please reconnect. Your exam continues and this is recorded.";
  if (cameraLost) return "Camera disconnected. Please reconnect. Your exam continues and this is recorded.";
  if (microphoneLost) return "Microphone disconnected. Please reconnect. Your exam continues and this is recorded.";
  if (connectionLost) return "Your exam continues. We're reconnecting your video to the exam team. You don't need to do anything.";
  return null;
}

export function CameraBanner(props: { cameraLost: boolean; microphoneLost: boolean; connectionLost: boolean }) {
  const text = cameraBannerText(props);
  return text ? <Notice warning><span aria-hidden="true">⚠ </span>{text}</Notice> : null;
}
