# Requirements
## jq package
dpkg -l jq &> /dev/null
if [ $? -eq 0 ]; then
    echo -e "\e[103m jq  is installed!"
else
    echo -e "\e[104m Installing jq package ..."
    apt-get update && apt-get install -yqq jq
fi
