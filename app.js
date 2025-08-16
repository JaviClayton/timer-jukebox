
const { useEffect, useMemo, useRef, useState } = React;

function TimerJukebox() {
  const [minutes, setMinutes] = useState(Number(localStorage.getItem("tj_minutes")) || 5);
  const [seconds, setSeconds] = useState(Number(localStorage.getItem("tj_seconds")) || 0);
  const [volume, setVolume] = useState(Number(localStorage.getItem("tj_volume")) || 0.7);
  const [loopSong, setLoopSong] = useState((localStorage.getItem("tj_loop") ?? "true") === "true");
  const [fadeOut, setFadeOut] = useState((localStorage.getItem("tj_fadeout") ?? "true") === "true");
  const [fadeOutSec, setFadeOutSec] = useState(Number(localStorage.getItem("tj_fadeoutSec")) || 5);
  const [useWakeLock, setUseWakeLock] = useState((localStorage.getItem("tj_wakelock") ?? "false") === "true");
  const [notifyOnFinish, setNotifyOnFinish] = useState((localStorage.getItem("tj_notify") ?? "true") === "true");
  const [vibrateOnFinish, setVibrateOnFinish] = useState((localStorage.getItem("tj_vibrate") ?? "true") === "true");
  const [sourceMode, setSourceMode] = useState(localStorage.getItem("tj_sourceMode") || "upload");
  const [songURL, setSongURL] = useState(localStorage.getItem("tj_songURL") || "");
  const [uploadedName, setUploadedName] = useState("");

  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState(null);

  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const deferredPromptRef = useRef(null);

  const audioRef = useRef(null);
  const endTimeRef = useRef(null);
  const baseVolumeRef = useRef(volume);
  const wakeLockRef = useRef(null);
  const rafRef = useRef(null);
  const objectURLRef = useRef(null);

  const totalMs = useMemo(() => Math.max(0, (minutes * 60 + seconds) * 1000), [minutes, seconds]);
  const progress = useMemo(() => {
    if (!isRunning || !endTimeRef.current || totalMs === 0) return 0;
    const remaining = Math.max(0, remainingMs);
    return Math.min(1, 1 - remaining / totalMs);
  }, [isRunning, remainingMs, totalMs]);

  useEffect(() => localStorage.setItem("tj_minutes", String(minutes)), [minutes]);
  useEffect(() => localStorage.setItem("tj_seconds", String(seconds)), [seconds]);
  useEffect(() => {
    localStorage.setItem("tj_volume", String(volume));
    baseVolumeRef.current = volume;
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);
  useEffect(() => localStorage.setItem("tj_loop", String(loopSong)), [loopSong]);
  useEffect(() => localStorage.setItem("tj_fadeout", String(fadeOut)), [fadeOut]);
  useEffect(() => localStorage.setItem("tj_fadeoutSec", String(fadeOutSec)), [fadeOutSec]);
  useEffect(() => localStorage.setItem("tj_wakelock", String(useWakeLock)), [useWakeLock]);
  useEffect(() => localStorage.setItem("tj_notify", String(notifyOnFinish)), [notifyOnFinish]);
  useEffect(() => localStorage.setItem("tj_vibrate", String(vibrateOnFinish)), [vibrateOnFinish]);
  useEffect(() => localStorage.setItem("tj_sourceMode", sourceMode), [sourceMode]);
  useEffect(() => localStorage.setItem("tj_songURL", songURL), [songURL]);

  function formatHMS(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  }

  function clearObjectURL() {
    if (objectURLRef.current) {
      URL.revokeObjectURL(objectURLRef.current);
      objectURLRef.current = null;
    }
  }

  async function ensureWakeLock() {
    if (!useWakeLock) return;
    try {
      if ("wakeLock" in navigator && navigator.wakeLock?.request) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {}
  }
  function releaseWakeLock(){ try { wakeLockRef.current?.release?.() } catch {} ; wakeLockRef.current=null; }

  function setMediaSessionMetadata(title) {
    try {
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new window.MediaMetadata({ title, artist: "Timer Jukebox", album: "" });
        const ms = navigator.mediaSession;
        ms.setActionHandler?.("play", () => audioRef.current?.play());
        ms.setActionHandler?.("pause", () => audioRef.current?.pause());
        ms.setActionHandler?.("stop", handleReset);
      }
    } catch {}
  }

  async function maybeAskNotificationPermission() {
    if (!notifyOnFinish) return;
    try {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch {}
  }

  function fireFinishSignals() {
    try {
      if (notifyOnFinish && "Notification" in window && Notification.permission === "granted") {
        new Notification("Timer done!", { body: "Your timer has finished.", silent: false });
      }
    } catch {}
    try { if (vibrateOnFinish && "vibrate" in navigator) navigator.vibrate?.([200,100,200,100,200]); } catch {}
  }

  function startTicker() {
    cancelTicker();
    const tick = () => {
      const now = Date.now();
      const end = endTimeRef.current ?? now;
      const rem = Math.max(0, end - now);
      setRemainingMs(rem);

      if (fadeOut && fadeOutSec > 0 && audioRef.current) {
        const fms = fadeOutSec * 1000;
        if (rem <= fms) {
          const ratio = Math.max(0, rem / fms);
          audioRef.current.volume = Math.max(0, baseVolumeRef.current * ratio);
        } else {
          audioRef.current.volume = baseVolumeRef.current;
        }
      }

      if (rem <= 0) { stopPlayback(true); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }
  function cancelTicker(){ if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current=null; }

  function stopPlayback(finished) {
    cancelTicker();
    setIsRunning(false);
    setIsPaused(false);
    endTimeRef.current = null;
    try {
      const a = audioRef.current;
      if (a) { a.pause(); a.loop=false; a.currentTime=0; a.volume=baseVolumeRef.current; }
    } catch {}
    releaseWakeLock();
    if (finished) fireFinishSignals();
  }

  const handleStart = async () => {
    setError(null);
    if (totalMs <= 0) { setError("Please set a duration greater than 0 seconds."); return; }
    let src = null;
    const a = audioRef.current;
    if (sourceMode === "upload" && objectURLRef.current) src = objectURLRef.current;
    else if (sourceMode === "url" && songURL.trim()) src = songURL.trim();
    if (!src) { setError("Please upload a song file or paste a valid audio URL."); return; }
    a.src = src; a.loop = loopSong; a.volume = volume;
    try { await a.play(); } catch(e) { setError("Playback failed. Try uploading a local file."); return; }
    await maybeAskNotificationPermission();
    await ensureWakeLock();
    baseVolumeRef.current = volume;
    endTimeRef.current = Date.now() + totalMs;
    setRemainingMs(totalMs);
    setIsRunning(true); setIsPaused(false);
    setMediaSessionMetadata(uploadedName || (sourceMode==="url" ? (new URL(songURL).pathname.split('/').pop() || "Stream") : "Song"));
    startTicker();
  };
  const handlePause = () => { if (!isRunning || isPaused) return; setIsPaused(true); try { audioRef.current?.pause(); } catch{}; cancelTicker(); };
  const handleResume = () => { if (!isRunning || !isPaused) return; setIsPaused(false); try { audioRef.current?.play(); } catch{}; if (remainingMs>0) endTimeRef.current=Date.now()+remainingMs; startTicker(); };
  const handleReset = () => { stopPlayback(false); setRemainingMs(totalMs); };
  const onFileChange = (e) => {
    setError(null); clearObjectURL();
    const f = e.target.files?.[0];
    if (f) { objectURLRef.current = URL.createObjectURL(f); setUploadedName(f.name); } else { setUploadedName(""); }
  };

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && isRunning && !isPaused && endTimeRef.current) {
        setRemainingMs(Math.max(0, endTimeRef.current - Date.now()));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isRunning, isPaused]);

  useEffect(() => () => { clearObjectURL(); cancelTicker(); }, []);

  // PWA helpers
  useEffect(() => {
    const onBip = (e) => { e.preventDefault(); deferredPromptRef.current = e; setCanInstall(true); };
    window.addEventListener('beforeinstallprompt', onBip);
    const mq = window.matchMedia('(display-mode: standalone)');
    const updateStandalone = () => setIsStandalone(mq.matches || navigator.standalone === true);
    updateStandalone();
    mq.addEventListener?.('change', updateStandalone);
    return () => { window.removeEventListener('beforeinstallprompt', onBip); mq.removeEventListener?.('change', updateStandalone); };
  }, []);
  const handleInstall = async () => {
    const evt = deferredPromptRef.current; if (!evt) return; evt.prompt(); await evt.userChoice.catch(()=>{}); setCanInstall(false); deferredPromptRef.current=null;
  };

  return (
    React.createElement("div", {className:"min-h-screen w-full bg-neutral-100 text-neutral-900 flex items-center justify-center p-6"},
      React.createElement("div", {className:"w-full max-w-4xl grid md:grid-cols-2 gap-6"},
        React.createElement("div", {className:"bg-white rounded-2xl shadow p-6 space-y-6"},
          React.createElement("header", {className:"flex items-center justify-between"},
            React.createElement("h1", {className:"text-2xl font-bold"}, "Timer Jukebox"),
            React.createElement("div", {className:"flex items-center gap-2"},
              (!isStandalone && canInstall) && React.createElement("button", {onClick:handleInstall, className:"px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm"}, "Install App"),
              React.createElement("a", {className:"text-sm underline opacity-70 hover:opacity-100", href:"#", onClick:(e)=>{e.preventDefault(); setMinutes(5); setSeconds(0); setVolume(0.7); setLoopSong(true); setFadeOut(true); setFadeOutSec(5); setUseWakeLock(false); setNotifyOnFinish(true); setVibrateOnFinish(true);}}, "Reset defaults")
            )
          ),
          React.createElement("section", null,
            React.createElement("label", {className:"block text-sm font-medium mb-2"}, "Duration (mm:ss)"),
            React.createElement("div", {className:"flex items-center gap-3"},
              React.createElement("input", {type:"number", min:0, max:999, value:minutes, onChange:(e)=>setMinutes(Math.max(0, Math.min(999, Number(e.target.value)||0))), className:"w-24 px-3 py-2 rounded-xl border"}),
              React.createElement("span", {className:"text-lg"}, ":"),
              React.createElement("input", {type:"number", min:0, max:59, value:seconds, onChange:(e)=>setSeconds(Math.max(0, Math.min(59, Number(e.target.value)||0))), className:"w-24 px-3 py-2 rounded-xl border"}),
              React.createElement("div", {className:"flex-1"}),
              React.createElement("div", {className:"flex gap-2"},
                [1,5,10].map(m => React.createElement("button", {key:m, onClick:()=>{setMinutes(m); setSeconds(0);}, className:"px-3 py-1.5 rounded-lg bg-neutral-200 hover:bg-neutral-300 text-sm"}, `${m}m`))
              )
            )
          ),
          React.createElement("section", {className:"space-y-3"},
            React.createElement("label", {className:"block text-sm font-medium"}, "Song source"),
            React.createElement("div", {className:"flex gap-2"},
              React.createElement("button", {onClick:()=>setSourceMode("upload"), className:`px-3 py-1.5 rounded-lg text-sm ${sourceMode==="upload"?"bg-neutral-900 text-white":"bg-neutral-200 hover:bg-neutral-300"}`}, "Upload"),
              React.createElement("button", {onClick:()=>setSourceMode("url"), className:`px-3 py-1.5 rounded-lg text-sm ${sourceMode==="url"?"bg-neutral-900 text-white":"bg-neutral-200 hover:bg-neutral-300"}`}, "URL")
            ),
            sourceMode==="upload"
              ? React.createElement("div", null,
                  React.createElement("input", {type:"file", accept:"audio/*", onChange:onFileChange, className:"block w-full text-sm"}),
                  uploadedName && React.createElement("p", {className:"text-xs mt-1 opacity-70"}, `Selected: ${uploadedName}`)
                )
              : React.createElement("div", null,
                  React.createElement("input", {type:"url", placeholder:"https://example.com/track.mp3", value:songURL, onChange:(e)=>setSongURL(e.target.value), className:"w-full px-3 py-2 rounded-xl border"}),
                  React.createElement("p", {className:"text-xs mt-1 opacity-70"}, "Tip: If a URL won’t play, it may block cross‑origin playback. Try uploading a local file.")
                )
          ),
          React.createElement("section", {className:"grid grid-cols-2 gap-4 items-center"},
            React.createElement("div", {className:"col-span-2"},
              React.createElement("label", {className:"block text-sm font-medium"}, `Volume: ${ (volume*100)|0 }%`),
              React.createElement("input", {type:"range", min:0, max:1, step:0.01, value:volume, onChange:(e)=>setVolume(Number(e.target.value)), className:"w-full"})
            ),
            React.createElement("label", {className:"inline-flex items-center gap-2 text-sm"},
              React.createElement("input", {type:"checkbox", checked:loopSong, onChange:(e)=>setLoopSong(e.target.checked)}), " Loop song while timer runs"
            ),
            React.createElement("div", {className:"flex items-center gap-3"},
              React.createElement("label", {className:"inline-flex items-center gap-2 text-sm"},
                React.createElement("input", {type:"checkbox", checked:fadeOut, onChange:(e)=>setFadeOut(e.target.checked)}), " Fade out at end"
              ),
              React.createElement("input", {type:"number", min:1, max:30, value:fadeOutSec, onChange:(e)=>setFadeOutSec(Math.max(1, Math.min(30, Number(e.target.value)||5))), className:"w-20 px-3 py-1.5 rounded-xl border text-sm"}),
              React.createElement("span", {className:"text-sm"}, "sec")
            ),
            React.createElement("label", {className:"inline-flex items-center gap-2 text-sm"},
              React.createElement("input", {type:"checkbox", checked:useWakeLock, onChange:(e)=>setUseWakeLock(e.target.checked)}), " Keep screen awake while running"
            ),
            React.createElement("label", {className:"inline-flex items-center gap-2 text-sm"},
              React.createElement("input", {type:"checkbox", checked:notifyOnFinish, onChange:(e)=>setNotifyOnFinish(e.target.checked)}), " Notify when done"
            ),
            React.createElement("label", {className:"inline-flex items-center gap-2 text-sm"},
              React.createElement("input", {type:"checkbox", checked:vibrateOnFinish, onChange:(e)=>setVibrateOnFinish(e.target.checked)}), " Vibrate on finish (mobile)"
            )
          ),
          React.createElement("section", {className:"flex flex-wrap gap-3 pt-2"},
            !isRunning && React.createElement("button", {onClick:handleStart, className:"px-4 py-2 rounded-xl bg-neutral-900 text-white hover:bg-black"}, "Start"),
            (isRunning && !isPaused) && React.createElement("button", {onClick:handlePause, className:"px-4 py-2 rounded-xl bg-neutral-200 hover:bg-neutral-300"}, "Pause"),
            (isRunning && isPaused) && React.createElement("button", {onClick:handleResume, className:"px-4 py-2 rounded-xl bg-neutral-900 text-white hover:bg-black"}, "Resume"),
            React.createElement("button", {onClick:handleReset, className:"px-4 py-2 rounded-xl bg-neutral-200 hover:bg-neutral-300"}, "Reset"),
            notifyOnFinish && React.createElement("button", {onClick:async ()=>{ try{ if(\"Notification\" in window && Notification.permission !== \"granted\"){ await Notification.requestPermission(); } if (Notification.permission === \"granted\") new Notification(\"Test notification\", { body: \"Looks good!\" }); } catch{} }, className:"px-4 py-2 rounded-xl bg-neutral-200 hover:bg-neutral-300"}, "Test notification")
          ),
          error && React.createElement("p", {className:"text-sm text-red-600"}, error),
          React.createElement("audio", {ref:audioRef, className:"hidden", preload:"auto"}),
          React.createElement("p", {className:"text-xs opacity-70 pt-2"},
            "Playback begins only after you click ", React.createElement("strong", null, "Start"), " (browser autoplay policies). You can switch apps; the music will continue until the timer ends."
          )
        ),
        React.createElement("div", {className:"bg-white rounded-2xl shadow p-6 flex flex-col items-center justify-center"},
          React.createElement("div", {className:"relative w-full aspect-video max-w-md"},
            React.createElement("div", {className:"absolute inset-0 flex items-center justify-center"},
              React.createElement(ProgressRing, {progress})
            ),
            React.createElement("div", {className:"absolute inset-0 flex flex-col items-center justify-center gap-1"},
              React.createElement("div", {className:"text-5xl font-bold tabular-nums"}, formatHMS(isRunning ? remainingMs : totalMs)),
              React.createElement("div", {className:"text-sm uppercase tracking-wide opacity-60"}, !isRunning ? "Ready" : isPaused ? "Paused" : "Running")
            )
          ),
          React.createElement("div", {className:"mt-4 text-center text-sm opacity-70"},
            uploadedName || (sourceMode==="url" && songURL ? `URL: ${songURL}` : "No song selected yet")
          )
        )
      )
    )
  );
}

function ProgressRing({ progress }) {
  const size = 280, stroke = 16, r = (size - stroke)/2;
  const c = 2 * Math.PI * r, offset = c - progress * c;
  return React.createElement("svg", {width:size, height:size, viewBox:`0 0 ${size} ${size}`},
    React.createElement("circle", {cx:size/2, cy:size/2, r, stroke:"#e5e5e5", strokeWidth:stroke, fill:"none"}),
    React.createElement("circle", {cx:size/2, cy:size/2, r, stroke:"#0a0a0a", strokeWidth:stroke, fill:"none", strokeLinecap:"round", strokeDasharray:`${c} ${c}`, strokeDashoffset:offset, style:{transition:"stroke-dashoffset 0.1s linear"}})
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(TimerJukebox));
