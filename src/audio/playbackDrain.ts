/** Network completion is independent of audio-device completion. */
export class PlaybackDrain {
  private generation=0
  private pending=0
  private drained:(()=>void)|null=null
  begin(){
    const generation=this.generation
    this.pending++
    let ended=false
    return {
      current:()=>generation===this.generation,
      end:()=>{if(ended||generation!==this.generation)return;ended=true;this.pending--;this.flush()},
    }
  }
  complete(callback:()=>void){this.drained=callback;this.flush()}
  clear(){this.generation++;this.pending=0;this.drained=null}
  private flush(){if(this.pending===0&&this.drained){const callback=this.drained;this.drained=null;callback()}}
}
