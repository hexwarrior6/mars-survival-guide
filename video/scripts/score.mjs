// One continuous original cue for the complete 31-second film.
// The same A-minor motif, instruments and beat grid run from start to finish;
// arrangement density changes gradually, with no separate intro music splice.
import {writeFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const rate=48000,seconds=31,count=rate*seconds,bpm=140,beat=60/bpm,tau=2*Math.PI;
const left=new Float64Array(count),right=new Float64Array(count);
let seed=14731;
const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1};
const clamp=(x)=>Math.max(0,Math.min(1,x));
const smooth=(x)=>{x=clamp(x);return x*x*(3-2*x)};
const energy=(t)=>.65+.35*smooth((t-1)/7);
function layer(at,duration,synth,pan=0){
 const start=Math.round(at*rate),length=Math.round(duration*rate);
 for(let n=0;n<length&&start+n<count;n++){
  if(start+n<0)continue;
  const value=synth(n/rate,n)*energy((start+n)/rate);
  left[start+n]+=value*(1-pan*.28);right[start+n]+=value*(1+pan*.28);
 }
}
const chords=[[110,130.8128,164.8138],[87.3071,110,130.8128],[130.8128,164.8138,195.9977],[97.9989,123.4708,146.8324]];
const roots=[55,43.6535,65.4064,48.9994];
const motif=[220,329.6276,391.9954,329.6276,261.6256,329.6276,293.6648,329.6276];
// A shared harmonic bed remains audible through all camera scales and cuts.
for(let i=0;i<count;i++){
 const t=i/rate,section=Math.floor(t/(beat*8)),phase=(t%(beat*8))/(beat*8);
 const a=chords[section%4],b=chords[(section+3)%4],mix=smooth(phase*8);
 const pad=(ch,offset)=>ch.reduce((sum,f,k)=>sum+Math.sin(tau*f*t+offset+k*.31)*.021+Math.sin(tau*f*.5*t+offset)*.012,0);
 const fade=smooth(t/.08)*smooth((seconds-t)/1.25);
 left[i]+=(pad(a,0)*mix+pad(b,0)*(1-mix))*fade;
 right[i]+=(pad(a,.09)*mix+pad(b,.09)*(1-mix))*fade;
}
const beats=Math.ceil(seconds/beat);
for(let b=0;b<beats;b++){
 const at=b*beat,root=roots[Math.floor(b/8)%4];
 // The opening uses the same kick and bass at a restrained level, then grows.
 layer(at,.34,t=>Math.sin(tau*(49*t+2.9*(1-Math.exp(-t*35))))*Math.exp(-t*18)*.47);
 layer(at,.4,t=>(Math.sin(tau*root*t)+.3*Math.sin(tau*root*2*t)+.12*Math.sin(tau*root*3*t))*Math.exp(-t*7)*(1-Math.exp(-t*130))*.17);
 const freq=motif[b%motif.length];
 const pluck=t=>(Math.sin(tau*freq*t)+.2*Math.sin(tau*freq*2*t)+.07*Math.sin(tau*freq*3*t))*Math.exp(-t*9)*(1-Math.exp(-t*160))*.13;
 layer(at,.65,pluck,b%2?.35:-.35);
 // Matching quiet delay adds depth without introducing a new instrument.
 layer(at+beat*.75,.65,t=>pluck(t)*.24,b%2?-.5:.5);
 if(b%2===1){const amount=.05+.07*smooth(at/8);layer(at,.16,t=>(noise()*.75+Math.sin(tau*180*t)*.25)*Math.exp(-t*35)*amount)}
 const hatLevel=.022+.035*smooth(at/8);
 layer(at+beat*.5,.06,t=>noise()*Math.exp(-t*95)*hatLevel,b%2?.55:-.55);
 // Add a quiet offbeat of the SAME motif after the build; never swap tracks.
 if(at>8&&at<28)layer(at+beat*.5,.45,t=>pluck(t)*.35,b%2?-.25:.25);
}
// Picture accents use the same tonal vocabulary and sit below the music.
const authoredToFinal=t=>t*31/35;
for(const at of [7.75,authoredToFinal(16.25),authoredToFinal(24.6875),authoredToFinal(31.25)]){
 layer(at,.75,t=>Math.sin(tau*(41.2*t+1.6*(1-Math.exp(-t*20))))*Math.exp(-t*8)*.2);
 layer(at-.25,.45,t=>noise()*(t<.25?(t/.25)**2:Math.exp(-(t-.25)*20))*.035,.4);
}
// Gentle sweep under the material reveal; the motif and pulse keep going.
layer(6.2,1.6,t=>noise()*.025*Math.sin(Math.PI*t/1.6)**2,-.4);
const wave=Buffer.alloc(44+count*4);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(2,22);wave.writeUInt32LE(rate,24);wave.writeUInt32LE(rate*4,28);wave.writeUInt16LE(4,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(count*4,40);
for(let i=0;i<count;i++){
 const t=i/rate,fade=smooth(t/.06)*smooth((seconds-t)/1.1);
 wave.writeInt16LE(Math.round(Math.tanh(left[i]*1.35)*.9*fade*32767),44+i*4);
 wave.writeInt16LE(Math.round(Math.tanh(right[i]*1.35)*.9*fade*32767),46+i*4);
}
const temp=fileURLToPath(new URL('../public/score31-premaster.wav',import.meta.url));
const out=fileURLToPath(new URL('../public/score31.wav',import.meta.url));
writeFileSync(temp,wave);
execFileSync('ffmpeg',['-v','error','-y','-i',temp,'-af','loudnorm=I=-16:TP=-1.5:LRA=8','-ar','48000','-t','31',out],{stdio:'inherit'});
unlinkSync(temp);
console.log('31s continuous original cue: 140 BPM, shared A-minor motif and instruments throughout.');
