package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MuteInfoFromMapTest {
    @Test
    fun `default values`() {
        val mute = MuteInfo()
        assertEquals("", mute.mutedUserId)
        assertEquals("", mute.mutedBy)
        assertEquals("", mute.mutedByName)
        assertNull(mute.reason)
        assertEquals(0L, mute.mutedAt)
        assertNull(mute.expiresAt)
        assertTrue(mute.isActive)
    }

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "mutedBy" to "admin-1",
                "mutedByName" to "Admin Alice",
                "reason" to "Spamming",
                "mutedAt" to 1_000_000_000L,
                "expiresAt" to 2_000_000_000L,
                "isActive" to true,
            )
        val mute = MuteInfo.fromMap(map, "user-42")

        assertEquals("user-42", mute.mutedUserId)
        assertEquals("admin-1", mute.mutedBy)
        assertEquals("Admin Alice", mute.mutedByName)
        assertEquals("Spamming", mute.reason)
        assertEquals(1_000_000_000L, mute.mutedAt)
        assertEquals(2_000_000_000L, mute.expiresAt)
        assertTrue(mute.isActive)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val mute = MuteInfo.fromMap(emptyMap(), "user-1")

        assertEquals("user-1", mute.mutedUserId)
        assertEquals("", mute.mutedBy)
        assertEquals("", mute.mutedByName)
        assertNull(mute.reason)
        assertEquals(0L, mute.mutedAt)
        assertNull(mute.expiresAt)
        assertTrue(mute.isActive)
    }

    @Test
    fun `fromMap handles null values`() {
        val map =
            mapOf<String, Any?>(
                "mutedBy" to null,
                "mutedByName" to null,
                "reason" to null,
                "mutedAt" to null,
                "expiresAt" to null,
                "isActive" to null,
            )
        val mute = MuteInfo.fromMap(map, "user-1")

        assertEquals("", mute.mutedBy)
        assertEquals("", mute.mutedByName)
        assertNull(mute.reason)
        assertEquals(0L, mute.mutedAt)
        assertNull(mute.expiresAt)
        assertTrue(mute.isActive)
    }

    @Test
    fun `fromMap handles permanent mute with null expiresAt`() {
        val map =
            mapOf<String, Any?>(
                "mutedBy" to "mod-1",
                "mutedByName" to "Moderator",
                "reason" to "Repeated violations",
                "mutedAt" to 1_000_000_000L,
                "expiresAt" to null,
                "isActive" to true,
            )
        val mute = MuteInfo.fromMap(map, "user-bad")

        assertNull(mute.expiresAt)
        assertTrue(mute.isActive)
    }

    // SHY-0653: both apps' muteGroupMember writes `userId`, `mutedAt` and, for a
    // timed mute, `duration` (ms), never `expiresAt`. Such a row must read
    // back ending at mutedAt + duration, or a timed mute never ends.
    @Test
    fun `fromMap reads a row saved with duration as ending at mutedAt plus duration`() {
        val map =
            mapOf<String, Any?>(
                "userId" to "user-1",
                "mutedAt" to 1_000_000L,
                "duration" to 3_600_000L,
            )
        val mute = MuteInfo.fromMap(map, "user-1")
        assertEquals(4_600_000L, mute.expiresAt)
    }

    @Test
    fun `fromMap reads a row saved with no duration and no expiresAt as permanent`() {
        val map =
            mapOf<String, Any?>(
                "userId" to "user-1",
                "mutedAt" to 1_000_000L,
            )
        val mute = MuteInfo.fromMap(map, "user-1")
        assertNull(mute.expiresAt)
    }

    @Test
    fun `fromMap prefers expiresAt over a duration on the same row`() {
        val map =
            mapOf<String, Any?>(
                "mutedAt" to 1_000_000L,
                "duration" to 3_600_000L,
                "expiresAt" to 9_000_000L,
            )
        assertEquals(9_000_000L, MuteInfo.fromMap(map, "user-1").expiresAt)
    }

    @Test
    fun `starting a timed mute ends it at mutedAt plus duration`() {
        val mute = MuteInfo.starting("user-1", "mod-1", "Mod", 1_000_000L, 3_600_000L, "spam")
        assertEquals(4_600_000L, mute.expiresAt)
        assertEquals("mod-1", mute.mutedBy)
        assertEquals("Mod", mute.mutedByName)
        assertEquals("spam", mute.reason)
        assertTrue(mute.isActive)
    }

    @Test
    fun `starting a mute with no duration is permanent`() {
        val mute = MuteInfo.starting("user-1", "mod-1", "Mod", 1_000_000L, null, null)
        assertNull(mute.expiresAt)
    }

    @Test
    fun `toRow is toMap plus the muted member's userId`() {
        val mute = MuteInfo.starting("user-1", "mod-1", "Mod", 1_000_000L, 3_600_000L, null)
        assertEquals(mute.toMap() + ("userId" to "user-1"), mute.toRow())
    }

    @Test
    fun `toRow read back by fromMap gives the same mute`() {
        val mute = MuteInfo.starting("user-1", "mod-1", "Mod", 1_000_000L, 3_600_000L, "spam")
        assertEquals(mute, MuteInfo.fromMap(mute.toRow(), "user-1"))
    }

    @Test
    fun `a timed mute is in force one millisecond before it ends`() {
        val mute = MuteInfo(mutedAt = 0L, expiresAt = 5_000L)
        assertTrue(mute.isInForceAt(4_999L))
    }

    @Test
    fun `a timed mute is not in force at the moment it ends`() {
        val mute = MuteInfo(mutedAt = 0L, expiresAt = 5_000L)
        assertEquals(false, mute.isInForceAt(5_000L))
    }

    @Test
    fun `a permanent mute is in force at any time`() {
        assertTrue(MuteInfo(mutedAt = 0L, expiresAt = null).isInForceAt(Long.MAX_VALUE))
    }

    @Test
    fun `an inactive mute is not in force`() {
        assertEquals(false, MuteInfo(expiresAt = null, isActive = false).isInForceAt(0L))
    }

    @Test
    fun `fromMap handles inactive mute`() {
        val map =
            mapOf<String, Any?>(
                "isActive" to false,
            )
        val mute = MuteInfo.fromMap(map, "user-1")
        assertEquals(false, mute.isActive)
    }

    @Test
    fun `toMap does not include mutedUserId`() {
        val mute = MuteInfo(mutedUserId = "user-42", mutedBy = "admin-1")
        val map = mute.toMap()
        assertNull(map["mutedUserId"])
        assertEquals("admin-1", map["mutedBy"])
    }

    @Test
    fun `toMap includes all non-mutedUserId fields`() {
        val mute =
            MuteInfo(
                mutedUserId = "user-42",
                mutedBy = "admin-1",
                mutedByName = "Admin",
                reason = "Spam",
                mutedAt = 1_000_000_000L,
                expiresAt = 2_000_000_000L,
                isActive = true,
            )
        val map = mute.toMap()
        assertEquals("admin-1", map["mutedBy"])
        assertEquals("Admin", map["mutedByName"])
        assertEquals("Spam", map["reason"])
        assertEquals(1_000_000_000L, map["mutedAt"])
        assertEquals(2_000_000_000L, map["expiresAt"])
        assertEquals(true, map["isActive"])
    }

    @Test
    fun `fromMap of toMap round-trip preserves data except mutedUserId`() {
        val original =
            MuteInfo(
                mutedUserId = "user-42",
                mutedBy = "admin-1",
                mutedByName = "Admin Alice",
                reason = "Spam",
                mutedAt = 1_000_000_000L,
                expiresAt = 2_000_000_000L,
                isActive = true,
            )
        val roundtripped = MuteInfo.fromMap(original.toMap(), "user-42")
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap of toMap round-trip with null reason and expiresAt`() {
        val original =
            MuteInfo(
                mutedUserId = "user-1",
                mutedBy = "mod-1",
                mutedByName = "Mod",
                reason = null,
                mutedAt = 1_000_000_000L,
                expiresAt = null,
                isActive = true,
            )
        val roundtripped = MuteInfo.fromMap(original.toMap(), "user-1")
        assertEquals(original, roundtripped)
    }
}
