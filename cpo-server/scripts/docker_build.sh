echo '#Setting env variables...'
cat ./docker/config-vars.sh

chmod +x ./docker/config-vars.sh
source ./docker/config-vars.sh

# manage building envs
cat ./docker/sample.config.json
envsubst < ./docker/sample.config.json > ./docker/config.json
cat ./docker/config.json

# manage building envs

env=$1 &&
tag="${REPOSITORY_HOST}/${REPOSITORY_USER}/${IMAGE_NAME}:$env-${PACKAGE_VERSION}" &&
echo "BUILD_ENV=$BUILD_ENV" &&
docker build \
    -f ./docker/ev_server.Dockerfile \
    -t $tag \
    --build-arg BUILD_ENV_ARG=${BUILD_ENV} \
    --no-cache .
