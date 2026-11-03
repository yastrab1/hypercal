package app.hypercal.calendar;
import static org.junit.Assert.*;
import org.junit.Test;

public class UpdateScheduleTest {
    @Test public void updatePublishedWhileOpenIsCheckedWithoutAnotherResume() {
        UpdateSchedule s = new UpdateSchedule(); s.resume();
        assertTrue(s.begin(100, false)); s.finish(100, true);
        assertFalse(s.begin(1000, false));
        assertTrue(s.begin(100 + UpdateSchedule.PERIODIC, false));
    }
    @Test public void offlineCheckRetriesSoonAndResumeDoesNotWaitFifteenMinutes() {
        UpdateSchedule s = new UpdateSchedule(); s.resume();
        assertTrue(s.begin(100, false)); s.finish(100, false);
        assertEquals(UpdateSchedule.RETRY, s.delay(100));
        assertTrue(s.begin(100 + UpdateSchedule.RETRY, false)); s.finish(30100, true);
        s.pause(); assertFalse(s.begin(30200, true));
        s.resume(); assertTrue(s.begin(30200, false));
    }
    @Test public void manualCheckBypassesDelayWithoutStartingDuplicateDownloads() {
        UpdateSchedule s = new UpdateSchedule(); s.resume();
        assertTrue(s.begin(100, false)); assertFalse(s.begin(101, true));
        s.finish(200, true); assertTrue(s.begin(201, true));
    }
}
