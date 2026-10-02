// Proximity voice chat for parties. Voices go straight between browsers (WebRTC); the party
// server only passes along the setup messages. In a raid you hear people louder the closer they
// are (enemies included, if they're talking near you); in the hub or while spectating, everyone
// in the party is at full volume.
import { actionsFor } from './keys.js';
import { save } from './save.js';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const NEAR = 8; // full volume inside this
const FAR = 55; // silent past this

export class Voice {
  constructor(net) {
    this.net = net;
    this.peers = new Map(); // member id -> { pc, audio, gain, offered }
    this.stream = null;
    this.on = false;
    this.talking = false;
    this.ctx = null;
    this.raid = null; // set by main
    this.onChange = () => {};
    net.on('msg', ({ from, d }) => { if (d && d.k && d.k[0] === 'v' && d.k.length <= 6) this.receive(from, d); });
    net.on('room', () => this.syncPeers());
    net.on('resumed', () => { if (this.on) this.hello(); });
    // Push to talk.
    const down = (code) => { if (this.mode === 'ptt' && actionsFor(code).includes('talk')) this.setTalking(true); };
    const up = (code) => { if (this.mode === 'ptt' && actionsFor(code).includes('talk')) this.setTalking(false); };
    window.addEventListener('keydown', (e) => { if (!e.repeat && !/INPUT|TEXTAREA/.test(e.target.tagName)) down(e.code); });
    window.addEventListener('keyup', (e) => up(e.code));
    window.addEventListener('mousedown', (e) => down(`Mouse${e.button}`));
    window.addEventListener('mouseup', (e) => up(`Mouse${e.button}`));
    window.addEventListener('blur', () => { if (this.mode === 'ptt') this.setTalking(false); });
  }

  get mode() { return save.get().settings.voice || 'off'; }

  // Turn voice on/off to match the setting. Asks for the microphone the first time.
  async apply() {
    const want = this.mode !== 'off';
    if (want && !this.on) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        save.update((d) => { d.settings.voice = 'off'; });
        this.onChange(`🎙️ No microphone access (${e.name || 'blocked'}). Voice chat is off.`);
        return;
      }
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      this.on = true;
      this.hello();
      this.syncPeers();
    } else if (!want && this.on) {
      this.on = false;
      for (const id of [...this.peers.keys()]) this.closePeer(id);
      if (this.stream) for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
      this.net.to('all', { k: 'vbye' });
    }
    this.setTalking(this.on && this.mode === 'open');
    this.onChange();
  }

  setTalking(on) {
    on = !!(on && this.on && this.stream);
    if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = on;
    if (on !== this.talking) { this.talking = on; this.onChange(); }
  }

  hello() { if (this.net.inParty) this.net.to('all', { k: 'vhi' }); }

  // Drop connections to anyone who left the party.
  syncPeers() {
    const room = this.net.room;
    const ids = new Set(room && room.members ? room.members.map((m) => m.id) : []);
    for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.closePeer(id);
  }

  peer(id) {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    p = { pc, audio: null, gain: null, offered: false, level: 0 };
    this.peers.set(id, p);
    if (this.stream) for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
    pc.onicecandidate = (e) => { if (e.candidate) this.net.to(id, { k: 'vice', c: e.candidate }); };
    pc.ontrack = (e) => this.hear(id, p, e.streams[0]);
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.closePeer(id); this.onChange(); };
    return p;
  }

  // Their voice goes through a volume knob we turn with distance.
  hear(id, p, stream) {
    if (p.audio) return;
    // Chrome only feeds WebRTC audio to WebAudio if it's also attached to a (muted) element.
    p.audio = new Audio();
    p.audio.srcObject = stream;
    p.audio.muted = true;
    p.audio.play().catch(() => {});
    const src = this.ctx.createMediaStreamSource(stream);
    p.gain = this.ctx.createGain();
    p.gain.gain.value = 1;
    src.connect(p.gain).connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.onChange();
  }

  closePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    try { p.pc.close(); } catch (e) { /* closed */ }
    if (p.gain) p.gain.disconnect();
    if (p.audio) p.audio.srcObject = null;
  }

  async call(id) {
    const p = this.peer(id);
    if (p.offered) return;
    p.offered = true;
    const offer = await p.pc.createOffer({ offerToReceiveAudio: true });
    await p.pc.setLocalDescription(offer);
    this.net.to(id, { k: 'voffer', sdp: p.pc.localDescription });
  }

  async receive(from, d) {
    if (!this.on) return;
    try {
      switch (d.k) {
        case 'vhi':
        case 'vack':
          if (d.k === 'vhi') this.net.to(from, { k: 'vack' });
          // The lower id makes the call, so two people never call each other at once.
          if (Number(this.net.id) < Number(from)) await this.call(from);
          break;
        case 'voffer': {
          const p = this.peer(from);
          await p.pc.setRemoteDescription(d.sdp);
          const answer = await p.pc.createAnswer();
          await p.pc.setLocalDescription(answer);
          this.net.to(from, { k: 'vans', sdp: p.pc.localDescription });
          break;
        }
        case 'vans': {
          const p = this.peers.get(from);
          if (p) await p.pc.setRemoteDescription(d.sdp);
          break;
        }
        case 'vice': {
          const p = this.peers.get(from);
          if (p) await p.pc.addIceCandidate(d.c);
          break;
        }
        case 'vbye': this.closePeer(from); break;
        default:
      }
    } catch (e) { console.warn('voice:', e.message); }
  }

  // Every frame: set each voice's volume from how far away they are.
  update() {
    if (!this.on || !this.peers.size) return;
    const raid = this.raid;
    const me = raid && raid.player;
    const inWorld = raid && raid.active && me && me.alive;
    for (const [id, p] of this.peers) {
      if (!p.gain) continue;
      let vol = 1;
      if (inWorld) {
        const body = raid.combatants.find((c) => !c.isPlayer && c.human && (c.owner === id || c.netId === `p${id}`));
        if (!body || !body.alive) vol = 0;
        else {
          const d = Math.hypot(body.pos.x - me.pos.x, body.pos.z - me.pos.z);
          vol = d <= NEAR ? 1 : d >= FAR ? 0 : 1 - (d - NEAR) / (FAR - NEAR);
          vol *= vol;
        }
      }
      p.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
    }
  }

  // Who we're connected to, for the UI.
  connected() {
    return [...this.peers.entries()].filter(([, p]) => p.audio && p.pc.connectionState === 'connected').map(([id]) => id);
  }
}
