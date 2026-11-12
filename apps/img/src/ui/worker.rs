use super::*;

type Receiver = mpsc::Receiver<Result<Completed, String>>;
#[derive(Clone, Copy)]
pub(super) enum Kind {
    Render,
    Io,
}
pub(super) enum IoJob {
    Load(PathBuf),
    Save(Arc<Animation>, PathBuf),
}
pub(super) enum Next {
    Render,
    Io(IoJob),
    RenderThenIo(IoJob),
}
#[derive(Default)]
pub(super) enum Worker {
    #[default]
    Idle,
    Io(Receiver),
    Rendering {
        receiver: Receiver,
        next: Option<Next>,
    },
}
impl Worker {
    pub(super) fn receiving(kind: Kind, receiver: Receiver) -> Self {
        match kind {
            Kind::Render => Self::Rendering {
                receiver,
                next: None,
            },
            Kind::Io => Self::Io(receiver),
        }
    }
    pub(super) fn spawn(
        kind: Kind,
        job: impl FnOnce() -> Result<Completed, String> + Send + 'static,
        waker: Option<Waker>,
    ) -> Self {
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(job());
            if let Some(waker) = waker {
                waker();
            }
        });
        Self::receiving(kind, receiver)
    }
    pub(super) fn busy(&self) -> bool {
        !matches!(self, Self::Idle)
    }
    pub(super) fn is_io(&self) -> bool {
        matches!(
            self,
            Self::Io(_)
                | Self::Rendering {
                    next: Some(Next::Io(_) | Next::RenderThenIo(_)),
                    ..
                }
        )
    }
    pub(super) fn request_io(&mut self, job: IoJob) -> Option<IoJob> {
        match self {
            Self::Idle => Some(job),
            Self::Rendering { next, .. } => {
                *next = Some(match next.take() {
                    Some(Next::Render | Next::RenderThenIo(_)) => Next::RenderThenIo(job),
                    _ => Next::Io(job),
                });
                None
            }
            Self::Io(_) => None,
        }
    }
    pub(super) fn request_render(&mut self) -> bool {
        match self {
            Self::Idle => true,
            Self::Rendering { next, .. } if matches!(next, None | Some(Next::Render)) => {
                *next = Some(Next::Render);
                false
            }
            _ => false,
        }
    }
    pub(super) fn poll(&mut self) -> Option<(Result<Completed, String>, Option<Next>)> {
        let result = match self {
            Self::Idle => return None,
            Self::Io(receiver) | Self::Rendering { receiver, .. } => match receiver.try_recv() {
                Ok(result) => result,
                Err(mpsc::TryRecvError::Empty) => return None,
                Err(mpsc::TryRecvError::Disconnected) => {
                    Err("Processing stopped unexpectedly.".into())
                }
            },
        };
        let next = match std::mem::take(self) {
            Self::Rendering { next, .. } => next,
            _ => None,
        };
        Some((result, next))
    }
}
