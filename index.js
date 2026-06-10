import pkg from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import {
  initDatabase,
  saveMemberAnalysis,
  markAsSentToSlack,
  closeDatabase, // FIX #10: was imported correctly here but called as CloseDatabase() in stop()
} from "./db.js";

dotenv.config();

const { App } = pkg;

const log = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg, ...args) =>
    process.env.NODE_ENV === "development" &&
    console.log(`[DEBUG] ${msg}`, ...args),
};

class SlackAIAgent {
  constructor() {
    this.app = express();
    this.slackApp = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      socketMode: true,
      appToken: process.env.SLACK_APP_TOKEN,
    });
    this.webClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    this.openai = new ChatOpenAI({
      model: "gpt-4",
      temperature: 0.3,
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.setupSlackEvent();
    this.setupExpress();
  }

  setupSlackEvent() {
    // FIX #1: Removed `const slackapp = new App(this.slack)` — this.slack doesn't exist
    // and this.slackApp is already created in the constructor.

    this.slackApp.event("team_join", async ({ event }) => {
      try {
        log.info(`New member joined: ${event.user.name}`);
        const userinfo = await this.getUserInfo(event.user.id);
        await this.analyzeAndPostMember(userinfo);
      } catch (error) {
        log.error("Error processing team_join", error);
      }
    });

    this.slackApp.event("member_joined_channel", async ({ event }) => {
      try {
        if (event.channel_type === "C") {
          log.info(`Member ${event.user} joined channel ${event.channel}`);
        }
        const userinfo = await this.getUserInfo(event.user);
        // FIX #3: was `analyzeAndPostMember(userinfo)` — missing `this.`
        await this.analyzeAndPostMember(userinfo);
      } catch (error) {
        log.error(`Member joining error: ${error}`);
      }
    });

    // FIX #2: was `this.slack.error(...)` — wrong reference; should be this.slackApp
    // FIX #15: was `"error.message"` (string literal) — should be the variable error.message
    this.slackApp.error(async (error) =>
      log.error("Slack error:", error.message)
    );
  }

  setupExpress() {
    // FIX #4: was `express.json` (property reference) — must be `express.json()` (function call)
    this.app.use(express.json());

    // FIX #5: /health route and test route were incorrectly nested.
    // They are now properly separated at the top level.
    this.app.get("/health", (req, res) => {
      res
        .status(200)
        .json({ message: "Healthy", timestamp: new Date().toISOString() });
    });

    if (process.env.NODE_ENV === "development") {
      this.app.post("/test/analyze-member", async (req, res) => {
        try {
          const { memberinfo } = req.body;
          if (!memberinfo) {
            // FIX #18: was 404 — correct status for missing body field is 400
            return res.status(400).json({ message: "Member info is required" });
          }
          const analysis = await this.analyzeAndPostMember(memberinfo);
          res.json({
            success: true,
            analysis,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          log.error(`Test analysis error: ${error}`);
          // FIX #19: was missing — catch block had no response, leaving client hanging
          res.status(500).json({ error: "Analysis failed" });
        }
      });
    }

    this.app.use((err, req, res, next) => {
      log.error("Express error:", err.message);
      return res.status(500).json({ error: "Internal Server Error" });
    });
  }

  async getUserInfo(userId) {
    const result = await this.webClient.users.info({ user: userId });
    const user = result.user;

    return {
      id: user.id,
      name: user.name,
      username: user.name,
      email: user.profile.email,
      title: user.profile?.title,
      timezone: user.tz,
      profile: {
        firstname: user.profile?.first_name,
        lastname: user.profile?.last_name,
        statustext: user.profile?.status_text,
      },
    };
  }

  async analyzeAndPostMember(memberinfo) {
    // FIX #11: was `analysisid` (lowercase) — unified to `analysisId` (camelCase) throughout
    let analysisId = null;
    try {
      log.info(`Processing member: ${memberinfo.name}`);
      const researchdata = await this.doBasicResearch(memberinfo);
      const analysis = await this.analyzeWithAI(memberinfo, researchdata);
      log.info(`Saving analysis to database for ${memberinfo.name}`);
      analysisId = await saveMemberAnalysis(memberinfo, analysis, researchdata);

      await this.postAnalysisToChannel(memberinfo, analysis, researchdata);

      if (analysisId) {
        await markAsSentToSlack(analysisId);
      }
    } catch (error) {
      log.error(`Error processing ${memberinfo.name}:`, error.message);
      if (analysisId) {
        log.info(
          `Analysis ${analysisId} saved to database but not sent to Slack due to error`
        );
      }
      // FIX #12: was `throw Error` (constructor without call, discards original) — should be `throw error`
      throw error;
    }
  }

  // FIX #6: was `async doBasicResearch()` with no parameter — memberinfo was undefined inside
  async doBasicResearch(memberinfo) {
    const result = [];

    try {
      if (memberinfo.email && !this.isPersonalEmail(memberinfo.email)) {
        const domain = memberinfo.email.split("@")[1];
        const companyinfo = await this.getCompanyInfo(domain);
        if (companyinfo) {
          result.push(companyinfo);
        }
        if (memberinfo.name) {
          const githubinfo = await this.getGithubInfo(memberinfo.name);
          if (githubinfo) {
            result.push(githubinfo);
          }
        }
      }
    } catch (error) {
      log.error("Research error:", error.message);
    }
    return result;
  }

  async getCompanyInfo(domain) {
    try {
      const response = await axios.get(`http://www.${domain}`, {
        timeout: 5000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const titleMatch = response.data.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : `Company: ${domain}`;

      return {
        url: `http://www.${domain}`,
        title: title,
        content: `Company website for ${domain}`,
        type: "company",
      };
    } catch (error) {
      log.error(`Could not fetch company info for ${domain}:`, error.message);
      return null;
    }
  }

  async getGithubInfo(name) {
    try {
      const response = await axios.get(
        `https://api.github.com/search/users?q=${encodeURIComponent(name)}`,
        { timeout: 5000 }
      );
      if (response.data.items && response.data.items.length > 0) {
        const user = response.data.items[0];
        return {
          url: user.html_url,
          // Fixed typo: "Githuv" → "GitHub"
          title: `GitHub: ${user.login}`,
          content: `${user.public_repos} public repositories`,
          type: "github",
        };
      }
    } catch (error) {
      log.error("Could not get GitHub info:", error.message);
    }
    return null;
  }

  async analyzeWithAI(memberinfo, researchdata) {
    const prompt = ChatPromptTemplate.fromTemplate(
      `Analyze this new community member for fit with our commercial product.
       Company: ${process.env.COMPANY_NAME || "Your_Company"}
       Product: ${process.env.COMPANY_PRODUCT || "YOUR_PRODUCT"}

       Member:
       - Name: {name}
       - Email: {email}
       - Title: {title}

       Research Data:
       {research}

       Provide a JSON response with:
       - fitScore (0-100): likelihood they'd be interested in our product
       - insights: array of 3-5 key observations
       - recommendations: array of 2-4 engagement suggestions

       Consider job title, company size, technical background, and budget and authority.`
    );

    try {
      const researchsummary =
        researchdata.length > 0
          // FIX #16: was `"\\n"` (escaped backslash-n string) — should be `"\n"` (real newline)
          ? researchdata.map((r) => `${r.title}: ${r.content}`).join("\n")
          : "Limited research data available";

      const chain = prompt.pipe(this.openai);
      const result = await chain.invoke({
        name: memberinfo.name,
        email: memberinfo.email || "Not provided",
        title: memberinfo.title || "Not provided",
        research: researchsummary,
      });

      const responseText = result.content || result;

      const cleanedresponse = responseText
        .replace(/```json\n?|\n?```/g, "")
        .trim();

      const analysis = JSON.parse(cleanedresponse);

      return {
        fitScore: Math.max(0, Math.min(100, analysis.fitScore || 50)),
        insights: Array.isArray(analysis.insights)
          ? analysis.insights
          : ["Analysis completed"],
        recommendations: Array.isArray(analysis.recommendations)
          ? analysis.recommendations
          : ["Follow up recommended"],
      };
    } catch (error) {
      log.error("AI analysis error:", error.message);
      return {
        fitScore: 50,
        insights: ["Unable to complete full analysis"],
        recommendations: ["Manual review recommended"],
      };
    }
  }

  async postAnalysisToChannel(member, analysis, researchdata) {
    const color =
      analysis.fitScore >= 80
        ? "#36a64f"
        : analysis.fitScore >= 60
        ? "#ffb84d"
        : analysis.fitScore >= 40
        ? "#ff9500"
        : "#ff4444";

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `New Member: ${member.name}` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Fit Score:* ${analysis.fitScore}/100` },
          // FIX #14: was missing colon after *Email*
          { type: "mrkdwn", text: `*Email:* ${member.email || "Not Provided"}` },
          // FIX #13: was `${member.title} || 'Not Provided'` (fallback inside the string)
          { type: "mrkdwn", text: `*Title:* ${member.title || "Not Provided"}` },
        ],
      },
    ];

    if (analysis.insights.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          // FIX #16: was `"\\n"` — should be `"\n"`
          text: `*Insights:*\n${analysis.insights.map((i) => `• ${i}`).join("\n")}`,
        },
      });
    }

    if (analysis.recommendations.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Recommendations:*\n${analysis.recommendations.map((i) => `• ${i}`).join("\n")}`,
        },
      });
    }

    blocks.push({
      // FIX #8: was `"content"` — not a valid Slack block type; correct type is "context"
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          // FIX #7: was `new Date.toISOString()` — Date is not a property; must be `new Date().toISOString()`
          text: `Analyzed: ${new Date().toISOString()}`,
        },
      ],
    });

    await this.webClient.chat.postMessage({
      channel: process.env.SLACK_PRIVATE_CHANNEL_ID,
      text: `New member analysis: ${member.name} (${analysis.fitScore}/100)`,
      blocks,
    });

    log.info(`Analysis posted to channel for ${member.name}`);
  }

  isPersonalEmail(email) {
    const personalDomains = [
      "gmail.com",
      "yahoo.com",
      "hotmail.com",
      "icloud.com",
      "outlook.com",
    ];
    const domain = email.split("@")[1]?.toLowerCase();
    return personalDomains.includes(domain);
  }

  async start() {
    try {
      log.info("Initializing database...");
      await initDatabase();

      const port = process.env.PORT || 3000;
      this.server = this.app.listen(port, () => {
        log.info(`Express server running on port ${port}`);
      });

      await this.slackApp.start();
      log.info("Slack bot connected");
      log.info("Slack AI Agent running!");

      if (process.env.NODE_ENV === "development") {
        log.info(
          `Test endpoint: POST http://localhost:${port}/test/analyze-member`
        );
      }
    } catch (error) {
      log.error("Failed to start:", error.message);
      process.exit(1);
    }
  }

  async stop() {
    log.info("Shutting down...");
    try {
      await this.slackApp.stop();
      if (this.server) {
        await new Promise((resolve) => this.server.close(resolve));
      }
      // FIX #10: was `CloseDatabase()` (capital C) — correct is `closeDatabase()`
      await closeDatabase();
      log.info("Stopped successfully");
    } catch (error) {
      log.error("Shutdown error:", error.message);
    }
    process.exit(0);
  }
}

const agent = new SlackAIAgent();

// FIX #9: was `"SIGNINT"` — correct signal name is `"SIGINT"`
process.on("SIGINT", () => agent.stop());
process.on("SIGTERM", () => agent.stop());

agent.start().catch((error) => {
  console.error("Startup failed:", error.message);
  // FIX #20: was `process.exit(0)` (success code) — failure should use exit code 1
  process.exit(1);
});

export default agent;