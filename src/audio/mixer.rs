use std::collections::VecDeque;

/// Combines synchronized windows, padding missing input with silence.
pub(super) struct AudioMixer {
    microphone: VecDeque<f32>,
    system: VecDeque<f32>,
    window_size: usize,
    buffer_limit: usize,
}

impl AudioMixer {
    pub(super) fn new(sample_rate: u32) -> Self {
        let window_size = (sample_rate as f32 * 0.6) as usize;
        let buffer_limit = window_size * 8;
        Self {
            microphone: VecDeque::with_capacity(buffer_limit),
            system: VecDeque::with_capacity(buffer_limit),
            window_size,
            buffer_limit,
        }
    }

    /// Returns the number of oldest samples dropped if the selected input overflows.
    pub(super) fn add_samples(&mut self, microphone: bool, samples: Vec<f32>) -> usize {
        let buffer = if microphone {
            &mut self.microphone
        } else {
            &mut self.system
        };
        buffer.extend(samples);
        let dropped = buffer.len().saturating_sub(self.buffer_limit);
        buffer.drain(..dropped);
        dropped
    }

    /// Drain the final partial window without padding extra recording time.
    pub(super) fn flush(&mut self) -> Option<Vec<f32>> {
        let remaining = self.microphone.len().max(self.system.len());
        if remaining == 0 { return None; }
        let original = self.window_size;
        self.window_size = remaining;
        let result = self.mix_next_window();
        self.window_size = original;
        result
    }

    pub(super) fn mix_next_window(&mut self) -> Option<Vec<f32>> {
        if self.microphone.len().max(self.system.len()) < self.window_size {
            return None;
        }
        let microphone_count = self.microphone.len().min(self.window_size);
        let system_count = self.system.len().min(self.window_size);
        let microphone = self
            .microphone
            .drain(..microphone_count)
            .chain(std::iter::repeat(0.0));
        let system = self
            .system
            .drain(..system_count)
            .chain(std::iter::repeat(0.0));

        // Mix directly from the queues: no intermediate input windows or padding allocations.
        Some(
            microphone
                .zip(system)
                .take(self.window_size)
                .map(|(mic, sys)| {
                    let sum = mic + sys;
                    let magnitude = sum.abs();
                    if magnitude > 1.0 {
                        sum / magnitude
                    } else {
                        sum
                    }
                })
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flush_preserves_final_partial_audio_without_extra_silence() {
        let mut mixer = AudioMixer::new(10);
        mixer.add_samples(true, vec![0.2; 2]);
        mixer.add_samples(false, vec![0.3; 3]);
        assert!(mixer.mix_next_window().is_none());
        assert_eq!(mixer.flush().unwrap(), vec![0.5, 0.5, 0.3]);
        assert!(mixer.flush().is_none());
    }

    #[test]
    fn waits_for_a_complete_window() {
        let mut mixer = AudioMixer::new(10);
        mixer.add_samples(true, vec![0.2; 5]);
        assert!(mixer.mix_next_window().is_none());
        mixer.add_samples(true, vec![0.3]);
        assert_eq!(
            mixer.mix_next_window().unwrap(),
            vec![0.2, 0.2, 0.2, 0.2, 0.2, 0.3]
        );
    }

    #[test]
    fn mixes_both_inputs_and_limits_peaks() {
        let mut mixer = AudioMixer::new(10);
        mixer.add_samples(true, vec![0.2, 0.8, -0.8, 0.5, -0.5, 0.0]);
        mixer.add_samples(false, vec![0.3, 0.8, -0.8, -0.5, 0.5, 0.0]);
        assert_eq!(
            mixer.mix_next_window().unwrap(),
            vec![0.5, 1.0, -1.0, 0.0, 0.0, 0.0]
        );
        assert!(mixer.mix_next_window().is_none());
    }

    #[test]
    fn pads_partial_input_and_preserves_following_windows() {
        let mut mixer = AudioMixer::new(10);
        mixer.add_samples(true, vec![0.2; 2]);
        mixer.add_samples(false, vec![0.3; 12]);
        assert_eq!(
            mixer.mix_next_window().unwrap(),
            vec![0.5, 0.5, 0.3, 0.3, 0.3, 0.3]
        );
        assert_eq!(mixer.mix_next_window().unwrap(), vec![0.3; 6]);
    }

    #[test]
    fn overflow_keeps_the_newest_samples_of_each_input() {
        let mut mixer = AudioMixer::new(10);
        let mut samples = vec![0.9; 5];
        samples.extend(vec![0.1; 48]);
        assert_eq!(mixer.add_samples(true, samples), 5);
        assert_eq!(mixer.add_samples(false, vec![0.2; 48]), 0);
        for _ in 0..8 {
            assert_eq!(mixer.mix_next_window().unwrap(), vec![0.1 + 0.2; 6]);
        }
        assert!(mixer.mix_next_window().is_none());
    }
}
