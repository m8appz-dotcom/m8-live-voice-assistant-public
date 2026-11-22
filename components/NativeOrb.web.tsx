// Native Skia remains intact for Android/iOS. Web uses its existing Three visual.
import { ThreeOrb } from './LiveVisuals'
import type { SessionState } from '../src/types/session'
export default function NativeOrb(props: { state: SessionState; micLevel: number; rotSpeed?: number; distortion?: number; size?: number }) {
  return <ThreeOrb {...props} />
}
