#Recruit CRM Chrome Extension.

This is a codebase for RecruitCRM chrome extensions
Extension works on following applications:
1. Linkedin
2. Facebook
3. Xing
4. Zoominfo
5. Indeed
6. Gmail
7. Outlook

Steps to be varified before making changes on extension:
1. Go to popup.js file and make following changes:
    1. Set ENV_URL value to env on which you need to work
    2. Change the EXTENSION_ID value to your local machine id
        **Note: EXTENSION_ID can be found after loading package to chrome extension inside package details.

2. Go to background.js and set the ENV_URL same as popup.js