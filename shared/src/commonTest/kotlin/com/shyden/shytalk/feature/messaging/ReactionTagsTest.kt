package com.shyden.shytalk.feature.messaging

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

/**
 * SHY-0645: the reaction journey finds the React item, the picker's emojis
 * and the badges by these tags on both phones. The journey names emojis by
 * their place in the picker, so the picker's order is pinned here too.
 */
class ReactionTagsTest {
    @Test
    fun `the picker offers six emojis in this order`() {
        assertEquals(
            listOf("❤️", "😂", "👍", "😮", "😢", "😡"),
            quickReactions,
        )
    }

    @Test
    fun `the React menu item has its tag`() {
        assertEquals("privateChat_reactMenuItem", REACT_MENU_ITEM_TAG)
    }

    @Test
    fun `the first picker emoji is pick 0`() {
        assertEquals("privateChat_reactionPick_0", reactionPickTag(0))
    }

    @Test
    fun `the last picker emoji is pick 5`() {
        assertEquals("privateChat_reactionPick_5", reactionPickTag(5))
    }

    @Test
    fun `a heart badge is numbered 0 under its message`() {
        assertEquals("privateChat_reactionBadge_m1_0", reactionBadgeTag("m1", "❤️"))
    }

    @Test
    fun `a thumbs-up badge is numbered 2 under its message`() {
        assertEquals("privateChat_reactionBadge_m1_2", reactionBadgeTag("m1", "👍"))
    }

    @Test
    fun `the same emoji under two messages has two tags`() {
        assertNotEquals(reactionBadgeTag("m1", "😂"), reactionBadgeTag("m2", "😂"))
    }

    @Test
    fun `an emoji the picker does not offer is named by its code units`() {
        // 🔥 is U+1F525, stored as the UTF-16 pair D83D DD25.
        assertEquals("privateChat_reactionBadge_m1_ud83ddd25", reactionBadgeTag("m1", "🔥"))
    }

    @Test
    fun `short code units are padded so two unknown emojis cannot share a tag`() {
        // Unpadded, "a"+"bc" (61,6263) and "ab"+"c" (6162,63) would both read 616263.
        assertNotEquals(reactionBadgeTag("m1", "a扣"), reactionBadgeTag("m1", "慢c"))
    }
}
