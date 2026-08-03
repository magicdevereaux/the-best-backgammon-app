from django.db import migrations, models


def backfill_turn_started_at(apps, schema_editor):
    """
    Give every in-flight game a starting clock.

    ``updated_at`` is an **approximation**, and a deliberately conservative one:
    it is ``auto_now``, so it marks the last write of any kind rather than the
    moment the current seat became the one owed an action. For a game whose last
    write *was* the turn flip it is exact; for one where the waiting player has
    since rolled, or the row was touched by a join or a cube action, it reads
    later than the truth and the deadline is therefore generous. Erring that way
    is the right side to be wrong on — an early deadline would hand someone a
    win they had not yet earned.

    In practice nothing is at stake: no deployment exists (see "Planned / Not
    Yet Implemented" in the root CLAUDE.md), so the only rows this can touch are
    local dev games.

    Only ``active`` games are backfilled. ``waiting`` games have no opponent to
    be idle yet and get their clock from ``join``; ``finished`` ones are done.
    Null stays a valid value and simply means "no clock running", which
    ``claim_timeout`` and ``Game.timeout_deadline`` both refuse to act on.
    """
    Game = apps.get_model("game", "Game")
    for game in Game.objects.filter(status="active").only("id", "updated_at"):
        # .update() rather than .save(), so `updated_at` (auto_now) is not
        # itself rewritten by the act of recording it.
        Game.objects.filter(pk=game.pk).update(turn_started_at=game.updated_at)


class Migration(migrations.Migration):

    dependencies = [
        ('game', '0004_game_player1_deleted_game_player2_deleted_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='game',
            name='turn_started_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(
            backfill_turn_started_at,
            # Reversing just drops the column; nothing to restore.
            migrations.RunPython.noop,
        ),
    ]
