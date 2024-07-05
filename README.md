# trackmania-leaderboard
A bun.sh script that generates a Trackmania leaderboard for a group

## Requirements

You need to have [bun.sh](https://bun.sh/) installed on your machine.
You also need an environment file with the following variables:
```bash
# .env
userpw=<youremail:yourpassword>
groupid=22024
```

In addition to that, if you want to display the group members in with their name instead of their id, you need a `.users.json`

```bash
# .users.json
{
    "2a1adc30-76ff-4b56-9caa-d81d517e2651": "Jan",
    [...]
}
```

## Usage
```bash
bun run --inspect .\trackmania.js
```
The server hosted by this command will be available at `http://localhost:3015/`