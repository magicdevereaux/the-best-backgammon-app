from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Add the per-turn reminder stamp read and written by
    ``manage.py send_turn_reminders``.

    **No backfill, deliberately.** Null means "no reminder has been sent for
    the turn currently in progress", and that is exactly the right thing to say
    about every existing row: none of them have ever been mailed. The first
    cron run after this migration will therefore reminder-mail whichever
    in-flight games are already inside ``TURN_REMINDER_LEAD_HOURS`` of their
    deadline, once each, and then go quiet — which is the intended behaviour,
    not a bug to migrate around.

    Reversing just drops the column; nothing is lost but the "already mailed"
    memory, and the worst case of losing it is one duplicate reminder.
    """

    dependencies = [
        ('game', '0005_game_turn_started_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='game',
            name='turn_reminder_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
