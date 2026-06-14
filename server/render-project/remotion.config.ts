import {Config} from '@remotion/cli/config';
import os from 'os';

// JPEG frames render much faster than PNG. Alpha renders (ProRes 4444) pass
// --image-format=png on the CLI, which overrides this.
Config.setVideoImageFormat('jpeg');

// Use most of the machine's cores (Remotion's default is conservative).
// Capped at 8 so weak machines stay responsive and big frames don't OOM.
Config.setConcurrency(Math.max(2, Math.min(8, (os.cpus() || []).length - 1)));

// VideoToolbox encode on Macs (H.264/H.265/ProRes, v4.0.228+) — big encode
// speedup; silently falls back to software on Windows/Linux.
Config.setHardwareAcceleration('if-possible');
