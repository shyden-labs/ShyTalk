package com.shyden.shytalk.core.util

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * A refused write is logged on the device, naming the action and the refusal
 * (SHY-0648 observability AC).
 *
 * Every group change on both phones goes through [firebaseCall] with an
 * action-naming message ("Failed to update roles", "Failed to remove
 * participant", ...), and Firestore refuses a write the rules deny by throwing.
 * These tests swap [firebaseCallErrorLogger] for a recorder so the log line is
 * asserted, not assumed. commonTest runs on the JVM, the Android host and the
 * iOS simulator, so each platform proves it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FirebaseCallLoggingTest {
    private val logged = mutableListOf<Pair<String, Exception>>()
    private var savedLogger: ((String, Exception) -> Unit)? = null

    @BeforeTest
    fun installRecordingLogger() {
        savedLogger = firebaseCallErrorLogger
        logged.clear()
        firebaseCallErrorLogger = { action, error -> logged += action to error }
    }

    @AfterTest
    fun restoreLogger() {
        savedLogger?.let { firebaseCallErrorLogger = it }
    }

    @Test
    fun `a refused group write logs the action it attempted and the refusal itself`() =
        runTest {
            val refusal = IllegalStateException("PERMISSION_DENIED: Missing or insufficient permissions.")

            firebaseCall<Unit>("Failed to update roles") { throw refusal }

            assertEquals(1, logged.size, "expected exactly one log line, got $logged")
            assertEquals("Failed to update roles", logged.single().first)
            assertSame(refusal, logged.single().second)
        }

    @Test
    fun `a refusal with no message of its own still logs the action and the refusal`() =
        runTest {
            val refusal = IllegalStateException()

            val result = firebaseCall<Unit>("Failed to remove participant") { throw refusal }

            assertTrue(result is Resource.Error, "expected Error, got $result")
            assertEquals(listOf<Pair<String, Exception>>("Failed to remove participant" to refusal), logged)
        }

    @Test
    fun `a write that succeeds logs nothing`() =
        runTest {
            firebaseCall("Failed to update group name") { "renamed" }

            assertEquals(emptyList(), logged)
        }

    @Test
    fun `a cancelled write is not logged as a refusal`() =
        runTest {
            try {
                firebaseCall<Unit>("Failed to update permissions") {
                    throw CancellationException("left the screen")
                }
                fail("CancellationException must propagate")
            } catch (_: CancellationException) {
                assertEquals(emptyList(), logged)
            }
        }
}
