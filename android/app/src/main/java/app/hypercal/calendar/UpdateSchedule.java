package app.hypercal.calendar;

/** Monotonic foreground polling. Resuming always permits a fresh check. */
final class UpdateSchedule {
    static final long PERIODIC = 15 * 60_000L;
    static final long RETRY = 30_000L;
    boolean active, running;
    private long next;
    void resume() { active = true; next = 0; }
    void pause() { active = false; }
    boolean begin(long now, boolean manual) {
        if (!active || running || (!manual && now < next)) return false;
        running = true;
        return true;
    }
    void finish(long now, boolean success) {
        running = false;
        next = now + (success ? PERIODIC : RETRY);
    }
    long delay(long now) { return Math.max(0, next - now); }
}
