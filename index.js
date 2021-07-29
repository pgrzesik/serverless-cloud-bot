"use strict";

const { api, data, schedule, params } = require("@serverless/cloud"); // eslint-disable-line
const { WebClient } = require("@slack/web-api");
const querystring = require("querystring");

const slackClient = new WebClient(params.SLACK_BOT_OAUTH_TOKEN);

api.post("/command/recognize", async (req, res) => {
  const payload = querystring.parse(req.body.toString());
  const { text, user_id: recognizedBy } = payload;

  const recognizedUsers = Array.from(
    text.matchAll(/<@([U|W][A-Z0-9]+)\|([^>]+)>/g),
    (m) => m[1]
  );

  const currentCountRecognizedBy =
    (await data.get(`given:${recognizedBy}`)) || 0;
  await data.set(`given:${recognizedBy}`, currentCountRecognizedBy + 1);
  try {
    await data.remove(
      `leader_given:${currentCountRecognizedBy}:${recognizedBy}`
    );
  } catch (err) {}
  await data.set(
    `leader_given:${currentCountRecognizedBy + 1}:${recognizedBy}`,
    true
  );

  for (const recognizedUser of recognizedUsers) {
    const current = (await data.get(`received:${recognizedUser}`)) || 0;
    await data.set(`received:${recognizedUser}`, current + 1);
    try {
      await data.remove(`leader_received:${current}:${recognizedUser}`);
    } catch (err) {}
    await data.set(`leader_received:${current + 1}:${recognizedUser}`, true);
  }

  try {
    await slackClient.chat.postMessage({
      text: `Recognition from <@${recognizedBy}>:\n\n>${text}`,
      channel: "recognitions",
    });
  } catch (err) {
    console.log("err", err);
  }

  res.send({});
});

schedule.every("1 hour", async () => {
  console.log(`Generating leaderboard...`);

  const givenLeaderboard = await data.get("leader_given:*", {
    limit: 3,
    reverse: true,
  });
  console.log("given", givenLeaderboard);

  const receivedLeaderboard = await data.get("leader_received:*", {
    limit: 3,
    reverse: true,
  });
  console.log("received", receivedLeaderboard);

  await slackClient.chat.postMessage(
    generateLeaderboardMessage(givenLeaderboard, receivedLeaderboard)
  );
});

const generateLeaderboardMessage = (givenLeaderboard, receivedLeaderboard) => {
  const generateGivers = () => {
    let text = "*Top givers*: \n\n";
    for (const givenEntry of givenLeaderboard.items) {
      const [_, num, user_id] = givenEntry.key.split(":");
      text += `${num} recognitions given - <@${user_id}>\n`;
    }

    return text;
  };

  const generateReceivers = () => {
    let text = "*Top receivers*: \n\n";
    for (const receivedEntry of receivedLeaderboard.items) {
      const [_, num, user_id] = receivedEntry.key.split(":");
      text += `${num} recognitions received - <@${user_id}>\n`;
    }

    return text;
  };

  const recognitionSummaryBlocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":tada: *Recognition summary* :tada:",
      },
    },
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: generateGivers(),
      },
    },
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: generateReceivers(),
      },
    },
  ];

  return {
    text: "Recognition summary",
    blocks: recognitionSummaryBlocks,
    channel: "recognitions",
  };
};
