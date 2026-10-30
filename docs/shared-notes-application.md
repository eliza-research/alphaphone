# Shared Notes installed-data candidate

This candidate mounts the upstream `NotesApplication` in the current Alpha
Notes view. That component owns source selection and uses the existing
`NotesWorkspace`, `NotesController` and editor. The Alpha wrapper projects its
selection and commands into the current shell. It does not create a second
Notes controller or migrate the installed collection into agent storage.

The installed source keeps `alphaphone:notes:v2` and its legacy migration keys.
Android keeps `notes-records:v1:device` and `notes-draft:v1:device`; the existing
browser document, Trash, recording store and recovery journal keep their names.
The host calls the existing open functions only after explicit source selection.
Opaque revisions and exact CAS receipts remain the write authority.

The common view exposes Trash, permanent-delete confirmation, retained-draft
review, saved playback, recording capture/review and deletion recovery. Alpha
supplies its existing recorder and retirement queue. Capturing and recovery do
not start from mounting or reflow. A source change or hidden view aborts only its
owned invocation; an unconfirmed stop still refuses later media work. The
compatibility writer delegates capture/restore commits to the same controller.
Home Save waits for the selected source's loaded snapshot and returns its actual
committed note identity. Failed or conflicting operations do not report success.

This branch requires the reviewed upstream Notes application/recovery changes.
Its source overlay is only a local test mechanism; the vendor checkout and
upstream pin are unchanged. The complete App host cutover remains separate.
Browser fixtures exercise actual stores and UI with controlled media ports;
they do not qualify native recording, device audio or the Android image.
