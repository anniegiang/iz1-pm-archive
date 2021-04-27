const path = require('path');
const Context = require('./server/context');
const Mail = require('./server/models/mail');
const Member = require('./server/models/member');
const MailBuilder = require('./server/views/mailBuilder');
const MailViewBuilder = require('./server/views/mailViewBuilder');
const User = require('./server/models/user');
const { encodeFullFilePath } = require('./utils');
class App extends Context {
  constructor() {
    super();
  }

  async init() {
    if (this.isServiceTerminated) {
      console.log(
        '❗️  Private Mail has termininated their service.\nThis script will no longer be able to fetch new mails.'
      );
      return;
    }

    if (!this.checkConfig) {
      console.log(
        '❗️ Your settings are incomplete. Fill in your info in userSettings.js.'
      );
      return;
    }

    try {
      const userProfileResponse = await this.pmController.getProfile();

      if (userProfileResponse.error || !userProfileResponse.data.user) {
        console.error('❗️ Your account was not found, cannot fetch mail.');
        return;
      }

      const user = new User(userProfileResponse.data.user);
      console.log(`💌 Fetching mails for ${user.name}...\n`);

      await this.database.setupOutputDirectory();
      const localMails = await this.database.localMails();

      let done = false;
      let page = 1;
      let allMails = [];
      let latestMail;
      let latestMember;

      while (!done) {
        const inbox = await this.pmController.getInbox(page);

        if (inbox.error || !inbox.data.mails) {
          console.error('❗️ There was an error getting your inbox: ', inbox);
          done = true;
          break;
        }

        if (page === 1) {
          const newestMail = inbox.data.mails[0];

          if (localMails.includes(newestMail.id)) {
            latestMail = new Mail(newestMail);
            latestMember = new Member(newestMail.member);
          }
        }

        allMails.push(...inbox.data.mails);

        if (!inbox.data.has_next_page) {
          done = true;
          break;
        }

        page++;
      }

      const members = {};
      let totalMails = 0;
      let failedMails = 0;
      const reversedMails = allMails.reverse(); //oldest to newest

      const mailView = new MailViewBuilder();

      if (!(await this.database.directoryExists(this.database.indexFilePath))) {
        await mailView.buildIndexPage();
      }

      for (const mail of reversedMails) {
        const mailObj = new Mail(mail);

        if (localMails.includes(mailObj.id)) {
          continue;
        }

        const mailDetails = await this.pmController.getMailDetail(mailObj.id);
        mailObj.setMailDetails(mailDetails.data);

        let member;

        if (members[mail.member.id]) {
          member = members[mail.member.id];
        } else {
          member = new Member(mail.member);
          const imageResponse = await this.pmController.downloadImage(
            member.imageUrl
          );
          member.setImageUrl(imageResponse.base64String);
          member[member.id] = member;
        }

        const newMail = new MailBuilder(mailObj, member, user);
        await newMail.setupMemberDirectory();

        const memberIndexPath = path.join(
          this.database.mailsDirectory,
          member.name,
          this.database.defaultIndexFileName
        );

        if (!(await this.database.directoryExists(memberIndexPath))) {
          await mailView.buildIndexPage(memberIndexPath);
        }

        console.log(`📩 Saving ${member.name} - ${mailObj.fileName}`);

        // add Home and current member to main viewer
        await mailView.createMemberLink(
          'All',
          this.database.indexFilePath,
          this.database.indexFilePath
        );

        await mailView.createMemberLink(
          member.name,
          memberIndexPath,
          this.database.indexFilePath
        );

        const memberDirs = await this.database.memberDirectoryPaths();

        // add Home to all member's views
        await Promise.all(
          memberDirs.map(async (dir) => {
            const dirPath = path.join(
              this.database.mailsDirectory,
              dir,
              this.database.defaultIndexFileName
            );

            await mailView.createMemberLink(
              'All',
              this.database.indexFilePath,
              dirPath
            );
          })
        );

        // add member links to each member view
        await Promise.all(
          memberDirs.map(async (dir) => {
            for (let dir2 of memberDirs) {
              const dirPath = path.join(
                this.database.mailsDirectory,
                dir,
                this.database.defaultIndexFileName
              );

              const dirPath2 = path.join(
                this.database.mailsDirectory,
                dir2,
                this.database.defaultIndexFileName
              );

              await mailView.createMemberLink(dir2, dirPath2, dirPath);
            }
          })
        );

        await newMail.saveMail(async (error, encoded) => {
          if (!error || encoded) {
            console.log('✅ Saved!\n');
            const mailPath = !encoded
              ? newMail.mailPath
              : encodeFullFilePath(newMail.mailPath);

            await mailView.createMailView(
              mailPath,
              mailObj,
              member,
              this.database.indexFilePath
            );

            await mailView.createMailView(
              mailPath,
              mailObj,
              member,
              memberIndexPath
            );

            totalMails++;
          } else {
            console.log('❌ Fail!\n');
            failedMails++;
          }
        });
      }

      if (latestMail) {
        console.log(
          `✅  No new mail, lastest mail is from ${latestMember.name} (${latestMail.id}).`
        );
      }

      if (totalMails) {
        console.log(
          `🎉 Finished saving ${totalMails} new ${
            totalMails > 2 ? 'mails' : 'mail'
          }!`
        );
      }

      if (failedMails) {
        console.log(
          `❗️ Failed to save ${failedMails} ${
            failedMails > 2 ? 'mails' : 'mail'
          }!`
        );
      }
    } catch (error) {
      console.error('❗️ ', error);
    }
  }

  get isServiceTerminated() {
    const today = new Date();
    const lastDay = new Date('2021-05-31');
    const sameMonth = today.getUTCMonth() === lastDay.getUTCMonth();
    const sameDay = today.getUTCDate() === lastDay.getUTCDate();
    const sameYear = today.getUTCFullYear() === lastDay.getUTCFullYear();
    return sameMonth && sameDay && sameYear;
  }

  get checkConfig() {
    return (
      this.settings.pm['user-id'] &&
      this.settings.pm['access-token'] &&
      this.settings.app.mailFolder
    );
  }
}

const app = new App();
app.init();
