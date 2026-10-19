package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val quickReactions =
    listOf(
        "\u2764\uFE0F", // heart
        "\uD83D\uDE02", // laughing
        "\uD83D\uDC4D", // thumbs up
        "\uD83D\uDE2E", // wow
        "\uD83D\uDE22", // sad
        "\uD83D\uDE21", // angry
    )

/** SHY-0645: the context-menu item that opens the reaction picker. */
const val REACT_MENU_ITEM_TAG = "privateChat_reactMenuItem"

/** SHY-0645: the picker's emoji at [index] in [quickReactions]. */
fun reactionPickTag(index: Int): String = "privateChat_reactionPick_$index"

/**
 * SHY-0645: the badge for [emoji] under message [messageId]. Numbered by the
 * emoji's place in [quickReactions]; an emoji the picker does not offer (a
 * reaction written by another client) is named `u` + its UTF-16 code units,
 * four hex digits each, so no two badges share a tag.
 */
fun reactionBadgeTag(
    messageId: String,
    emoji: String,
): String {
    val index = quickReactions.indexOf(emoji)
    val n = if (index >= 0) "$index" else "u" + emoji.map { it.code.toString(16).padStart(4, '0') }.joinToString("")
    return "privateChat_reactionBadge_${messageId}_$n"
}

@Composable
fun ReactionPicker(
    onReact: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        shadowElevation = 4.dp,
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            quickReactions.forEachIndexed { index, emoji ->
                Text(
                    text = emoji,
                    fontSize = 24.sp,
                    modifier =
                        Modifier
                            .testTag(reactionPickTag(index))
                            .clickable { onReact(emoji) }
                            .padding(4.dp),
                )
            }
        }
    }
}

@Composable
fun ReactionBadges(
    reactions: Map<String, List<String>>,
    currentUserId: String,
    messageId: String,
    onToggleReaction: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (reactions.isEmpty()) return

    Row(
        modifier = modifier.padding(top = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        reactions.forEach { (emoji, userIds) ->
            val isOwnReaction = currentUserId in userIds
            Surface(
                modifier =
                    Modifier
                        .testTag(reactionBadgeTag(messageId, emoji))
                        .clickable { onToggleReaction(emoji) },
                shape = RoundedCornerShape(12.dp),
                color =
                    if (isOwnReaction) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    },
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(text = emoji, fontSize = 14.sp)
                    if (userIds.size > 1) {
                        Text(
                            text = "${userIds.size}",
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }
    }
}
